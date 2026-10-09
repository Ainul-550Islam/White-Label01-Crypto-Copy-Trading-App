// # Ensures ticket creation, reply thread, and status tracking
"use client";
import type { JSX } from 'react';

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { operationsApi } from "@/api/operations-api";
import { clientLifecycleApi } from "@/api/client-lifecycle-api";
import { useTenant } from "@/tenant/tenant.context";
import { PageContainer } from "@/layout/page-container";
import { StatusBadge } from "@/components/status-badge";

export interface SupportTicketMessage {
  id: string;
  sender: "CUSTOMER" | "SUPPORT_DESK";
  body: string;
  createdAt: string;
}

export interface SupportTicketRecord {
  ticketId: string;
  subject: string;
  category: "COPY_TRADING" | "FUNDING_CUSTODY" | "EXCHANGE_CONNECTIVITY" | "COMPLIANCE_KYC" | "GENERAL";
  priority: "NORMAL" | "HIGH" | "URGENT";
  status: "OPEN" | "IN_REVIEW" | "RESOLVED";
  createdAt: string;
  messages: SupportTicketMessage[];
}

export function SupportPage(): JSX.Element {
  const { tenant } = useTenant();
  const supportEmail = tenant?.branding?.supportEmail ?? "support@example.com";

  const maintenanceQuery = useQuery({
    queryKey: ["support-maintenance"],
    queryFn: () => operationsApi.getCurrentMaintenance(),
  });

  const restrictionsQuery = useQuery({
    queryKey: ["support-restrictions"],
    queryFn: () => clientLifecycleApi.listRestrictions(),
  });

  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<SupportTicketRecord["category"]>("COPY_TRADING");
  const [priority, setPriority] = useState<SupportTicketRecord["priority"]>("NORMAL");
  const [body, setBody] = useState("");
  const [replyText, setReplyText] = useState("");

  const activeTicket = tickets.find((t) => t.ticketId === selectedTicketId) ?? tickets[0] ?? null;

  const handleCreateTicket = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) return;
    const now = new Date().toISOString();
    const ticketId = `TKT-${1000 + tickets.length + 1}`;
    const newTicket: SupportTicketRecord = {
      ticketId,
      subject: subject.trim(),
      category,
      priority,
      status: "OPEN",
      createdAt: now,
      messages: [
        {
          id: `${ticketId}-msg-1`,
          sender: "CUSTOMER",
          body: body.trim(),
          createdAt: now,
        },
      ],
    };
    setTickets((prev) => [newTicket, ...prev]);
    setSelectedTicketId(ticketId);
    setSubject("");
    setBody("");
  };

  const handleAddReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTicket || !replyText.trim()) return;
    const now = new Date().toISOString();
    setTickets((prev) =>
      prev.map((t) =>
        t.ticketId === activeTicket.ticketId
          ? {
              ...t,
              messages: [
                ...t.messages,
                {
                  id: `${t.ticketId}-msg-${t.messages.length + 1}`,
                  sender: "CUSTOMER",
                  body: replyText.trim(),
                  createdAt: now,
                },
              ],
            }
          : t,
      ),
    );
    setReplyText("");
  };

  return (
    <PageContainer
      title="Support & Helpdesk"
      description="Create and track support tickets, inspect active account notices, and reach tenant operations"
    >
      <div className="space-y-6" data-testid="support-page">
        {/* Operational & Account Diagnostics */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded border bg-card p-4 text-xs">
            <h2 className="text-sm font-semibold">Platform & Maintenance Status</h2>
            {maintenanceQuery.data?.active ? (
              <div className="mt-2 rounded border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <div className="font-semibold">{maintenanceQuery.data.title ?? "Maintenance Active"}</div>
                <p className="mt-1">{maintenanceQuery.data.message}</p>
              </div>
            ) : (
              <p className="mt-2 text-muted">
                All copy-trading, OMS, and custody subsystems are operating normally.
              </p>
            )}
            <div className="mt-3 border-t pt-2">
              Direct Support Contact:{" "}
              <a href={`mailto:${supportEmail}`} className="font-medium underline">
                {supportEmail}
              </a>
            </div>
          </div>

          <div className="rounded border bg-card p-4 text-xs">
            <h2 className="text-sm font-semibold">Account Restrictions & Quick Links</h2>
            {(restrictionsQuery.data ?? []).filter((r) => r.status === "ACTIVE").length > 0 ? (
              <ul className="mt-2 list-disc pl-4 text-rose-800">
                {(restrictionsQuery.data ?? [])
                  .filter((r) => r.status === "ACTIVE")
                  .map((r) => (
                    <li key={r.id}>
                      <strong>{r.restrictionType}</strong>: {r.reason}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-2 text-muted">No active restrictions on your account.</p>
            )}
            <div className="mt-3 flex flex-wrap gap-3 border-t pt-2">
              <Link href="/activity" className="underline">
                View Activity & Audit Log
              </Link>
              <Link href="/notifications" className="underline">
                Notification Preferences
              </Link>
              <Link href="/account/restrictions" className="underline">
                Account Restrictions
              </Link>
            </div>
          </div>
        </div>

        {/* Create Ticket Form + Ticket Thread */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleCreateTicket}
            className="space-y-3 rounded border bg-card p-4 text-xs"
            data-testid="create-support-ticket-form"
          >
            <h2 className="text-sm font-semibold">Open a New Support Ticket</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-muted">Category</span>
                <select
                  aria-label="Ticket Category"
                  value={category}
                  onChange={(e) =>
                    setCategory(e.target.value as SupportTicketRecord["category"])
                  }
                  className="w-full rounded border px-2 py-1.5"
                >
                  <option value="COPY_TRADING">Copy Trading & Execution</option>
                  <option value="FUNDING_CUSTODY">Funding, Deposits & Withdrawals</option>
                  <option value="EXCHANGE_CONNECTIVITY">Exchange API Connectivity</option>
                  <option value="COMPLIANCE_KYC">Compliance & Verification</option>
                  <option value="GENERAL">General Inquiry</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-muted">Priority</span>
                <select
                  aria-label="Ticket Priority"
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as SupportTicketRecord["priority"])
                  }
                  className="w-full rounded border px-2 py-1.5"
                >
                  <option value="NORMAL">Normal</option>
                  <option value="HIGH">High</option>
                  <option value="URGENT">Urgent</option>
                </select>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-muted">Subject</span>
              <input
                aria-label="Ticket Subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of the issue"
                className="w-full rounded border px-2.5 py-1.5"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-muted">Description & Reference IDs</span>
              <textarea
                aria-label="Ticket Description"
                rows={4}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Include subscriptionId, executionId, or orderId if applicable..."
                className="w-full rounded border px-2.5 py-1.5"
              />
            </label>
            <button
              type="submit"
              disabled={!subject.trim() || !body.trim()}
              className="rounded bg-slate-900 px-4 py-2 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              Submit Support Ticket
            </button>
          </form>

          {/* Ticket List & Thread */}
          <div className="space-y-4 rounded border bg-card p-4 text-xs">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Your Support Tickets ({tickets.length})</h2>
            </div>

            {tickets.length === 0 ? (
              <p className="text-muted">
                You have not submitted any support tickets in this session. Use the form on the left to open a ticket.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {tickets.map((t) => (
                    <button
                      key={t.ticketId}
                      type="button"
                      onClick={() => setSelectedTicketId(t.ticketId)}
                      className={`rounded border px-2.5 py-1 text-left ${
                        activeTicket?.ticketId === t.ticketId
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <span className="font-mono font-semibold">{t.ticketId}</span>: {t.subject}
                    </button>
                  ))}
                </div>

                {activeTicket && (
                  <div className="space-y-3 rounded border p-3" data-testid="support-ticket-thread">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                      <div>
                        <span className="font-semibold">{activeTicket.subject}</span>
                        <span className="ml-2 text-muted">({activeTicket.category})</span>
                      </div>
                      <StatusBadge status={activeTicket.status} />
                    </div>

                    <ul className="space-y-2">
                      {activeTicket.messages.map((msg) => (
                        <li key={msg.id} className="rounded bg-slate-50 p-2">
                          <div className="flex justify-between text-[11px] text-muted">
                            <span className="font-semibold">{msg.sender}</span>
                            <span>{new Date(msg.createdAt).toLocaleTimeString()}</span>
                          </div>
                          <p className="mt-1">{msg.body}</p>
                        </li>
                      ))}
                    </ul>

                    <form onSubmit={handleAddReply} className="flex gap-2 pt-2">
                      <input
                        aria-label="Reply message"
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                        placeholder="Add a reply to this ticket..."
                        className="flex-1 rounded border px-2.5 py-1"
                      />
                      <button
                        type="submit"
                        disabled={!replyText.trim()}
                        className="rounded border px-3 py-1 font-medium hover:bg-slate-50 disabled:opacity-40"
                      >
                        Reply
                      </button>
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
