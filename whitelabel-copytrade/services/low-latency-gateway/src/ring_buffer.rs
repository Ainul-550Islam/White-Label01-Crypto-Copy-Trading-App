//! Bounded, lock-minimized ring buffer with explicit overflow/drop
//! accounting and deterministic consumer semantics.
//!
//! Lock discipline: the single mutex guards only slot bookkeeping (pointer
//! bump + slot swap). No allocation, no syscall and no await happens inside
//! the critical section, so hold times are a few nanoseconds even under
//! contention. This is a deliberate safe-Rust trade: correctness and
//! auditable memory safety over lock-free unsafe internals.
//!
//! Policy neutrality: the buffer itself never silently discards. A full
//! ring reports `RingPushError::Full`, and the CALLER decides — drop with
//! accounting (non-critical market-data fanout under an explicit shedding
//! policy) or fail closed (execution-critical traffic).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

#[derive(Debug)]
pub struct RingStats {
    pub writes: AtomicU64,
    pub reads: AtomicU64,
    pub overflow: AtomicU64,
    pub drops: AtomicU64,
}

impl RingStats {
    fn new() -> RingStats {
        RingStats {
            writes: AtomicU64::new(0),
            reads: AtomicU64::new(0),
            overflow: AtomicU64::new(0),
            drops: AtomicU64::new(0),
        }
    }
}

struct Slots<T> {
    head: usize,
    len: usize,
    buf: Vec<Option<T>>,
}

/// Bounded FIFO ring buffer.
pub struct RingBuffer<T> {
    slots: Mutex<Slots<T>>,
    capacity: usize,
    stats: RingStats,
}

/// Result of a rejected push: ownership of the item returns to the caller so
/// it can apply its explicit policy (count-and-drop, or fail closed).
#[derive(Debug)]
pub enum RingPushError<T> {
    Full(T),
    Closed(T),
}

impl<T> RingBuffer<T> {
    /// Capacity is bounded below by 1 and above by `MAX_CAPACITY` so a bad
    /// configuration can neither spin nor exhaust memory.
    pub const MAX_CAPACITY: usize = 1 << 22;

    pub fn bounded(capacity: usize) -> RingBuffer<T> {
        let capacity = capacity.clamp(1, Self::MAX_CAPACITY);
        let mut buf = Vec::with_capacity(capacity);
        buf.resize_with(capacity, || None);
        RingBuffer {
            slots: Mutex::new(Slots {
                head: 0,
                len: 0,
                buf,
            }),
            capacity,
            stats: RingStats::new(),
        }
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// Pushes one item without blocking. On a full ring this increments the
    /// overflow counter and returns the item; whether that becomes a counted
    /// drop or a refused critical write is the caller's policy.
    pub fn try_push(&self, item: T) -> Result<(), RingPushError<T>> {
        let mut slots = self.slots.lock().expect("ring mutex poisoned");
        if slots.len == slots.buf.len() {
            self.stats.overflow.fetch_add(1, Ordering::Relaxed);
            return Err(RingPushError::Full(item));
        }
        let tail = (slots.head + slots.len) % slots.buf.len();
        slots.buf[tail] = Some(item);
        slots.len += 1;
        self.stats.writes.fetch_add(1, Ordering::Relaxed);
        Ok(())
    }

    /// Pops the oldest item, if any. Never blocks.
    pub fn try_pop(&self) -> Option<T> {
        let mut slots = self.slots.lock().expect("ring mutex poisoned");
        if slots.len == 0 {
            return None;
        }
        let head = slots.head;
        let item = slots.buf[head].take();
        slots.head = (slots.head + 1) % slots.buf.len();
        slots.len -= 1;
        self.stats.reads.fetch_add(1, Ordering::Relaxed);
        item
    }

    pub fn len(&self) -> usize {
        self.slots.lock().expect("ring mutex poisoned").len
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Consumer lag in items: writes minus reads (monotonic counters).
    pub fn lag(&self) -> u64 {
        self.stats
            .writes
            .load(Ordering::Relaxed)
            .saturating_sub(self.stats.reads.load(Ordering::Relaxed))
    }

    pub fn overflow_count(&self) -> u64 {
        self.stats.overflow.load(Ordering::Relaxed)
    }

    pub fn drop_count(&self) -> u64 {
        self.stats.drops.load(Ordering::Relaxed)
    }

    pub fn write_count(&self) -> u64 {
        self.stats.writes.load(Ordering::Relaxed)
    }

    pub fn read_count(&self) -> u64 {
        self.stats.reads.load(Ordering::Relaxed)
    }

    /// Explicit, counted drop. Only the caller that already holds a rejected
    /// item can call this; the buffer itself never invokes it internally.
    pub fn count_dropped(&self, n: u64) {
        self.stats.drops.fetch_add(n, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // [CHECK 13] ring buffer is bounded: capacity is never exceeded.
    #[test]
    fn ring_is_bounded_to_capacity() {
        let ring: RingBuffer<u64> = RingBuffer::bounded(4);
        for i in 0..4 {
            assert!(ring.try_push(i).is_ok());
        }
        assert!(matches!(ring.try_push(99), Err(RingPushError::Full(99))));
        assert_eq!(ring.len(), 4);
        assert_eq!(ring.capacity(), 4);
    }

    // [CHECK 14] overflow attempts are counted and never silently lost.
    #[test]
    fn ring_overflow_is_counted_and_item_returned() {
        let ring: RingBuffer<u8> = RingBuffer::bounded(2);
        assert!(ring.try_push(1).is_ok());
        assert!(ring.try_push(2).is_ok());
        assert!(matches!(ring.try_push(3), Err(RingPushError::Full(3))));
        assert_eq!(ring.overflow_count(), 1);
        // Explicit counted drop by the caller (non-critical shedding policy).
        ring.count_dropped(1);
        assert_eq!(ring.drop_count(), 1);
    }

    // FIFO order determinism.
    #[test]
    fn ring_preserves_fifo_order() {
        let ring: RingBuffer<u64> = RingBuffer::bounded(8);
        for i in 0..8 {
            let _ = ring.try_push(i);
        }
        for i in 0..8 {
            assert_eq!(ring.try_pop(), Some(i));
        }
        assert!(ring.try_pop().is_none());
        assert_eq!(ring.read_count(), 8);
        assert_eq!(ring.write_count(), 8);
        assert_eq!(ring.lag(), 0);
    }

    // Wraparound correctness across the capacity boundary.
    #[test]
    fn ring_wraps_correctly() {
        let ring: RingBuffer<u32> = RingBuffer::bounded(3);
        for i in 0..3 {
            ring.try_push(i).expect("fill");
        }
        for i in 3..6 {
            assert_eq!(ring.try_pop(), Some(i - 3), "fifo across wrap at {i}");
            ring.try_push(i).expect("wrap push");
        }
        assert_eq!(ring.len(), 3);
        assert_eq!(ring.try_pop(), Some(3));
        assert_eq!(ring.try_pop(), Some(4));
        assert_eq!(ring.try_pop(), Some(5));
        assert_eq!(ring.lag(), 0); // 6 writes, 6 reads
        ring.try_push(6).expect("one more");
        assert_eq!(ring.lag(), 1);
    }

    // Capacity clamping: absurd configuration cannot allocate unbounded.
    #[test]
    fn capacity_is_clamped_to_safe_range() {
        let tiny: RingBuffer<u8> = RingBuffer::bounded(0);
        assert_eq!(tiny.capacity(), 1);
        let huge: RingBuffer<u8> = RingBuffer::bounded(usize::MAX);
        assert_eq!(huge.capacity(), RingBuffer::<u8>::MAX_CAPACITY);
    }
}
