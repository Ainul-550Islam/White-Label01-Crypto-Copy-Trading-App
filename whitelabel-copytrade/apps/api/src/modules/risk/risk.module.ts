import { Module } from '@nestjs/common';

import { RiskController } from './risk.controller';
import { RiskPolicyService } from './risk-policy.service';
import { RiskProtectionService } from './risk-protection.service';
import { RiskStateService } from './risk-state.service';

/**
 * The Part 8 risk control plane.
 *
 * Three services, one honest division of labour:
 *
 *   RiskPolicyService      - the versioned configuration document, ceiling
 *                            refusal, loosening confirmation, rollback, and
 *                            the audit + invalidation job around a change;
 *   RiskProtectionService  - the kill-switch lifecycle this console owns
 *                            (engage/acknowledge/clear for ACCOUNT, STRATEGY,
 *                            SYMBOL), sharing the durable rows with the
 *                            execution console;
 *   RiskStateService       - pure reads of the mirrored hot state (status,
 *                            events, snapshots, exposure, PnL, summaries).
 *
 * What this module is NOT, which matters more than what it is: it does not
 * import, expose or wrap anything from the execution module's order path.
 * The risk gate the orders obey is the Python engine's (the core package);
 * this plane only edits the policy and pulls the levers the gate reads.
 * There is no service here that can submit, approve, cancel or retry an
 * order, and Prisma-level writes are confined to the risk configuration/
 * switch tables plus audit records. The QueueService dependency is used
 * exclusively for the control-plane jobs on the `risk-control` queue
 * (publish configuration, sync snapshot metadata, reconcile protections) -
 * never the execution queue.
 */
@Module({
  controllers: [RiskController],
  providers: [RiskPolicyService, RiskProtectionService, RiskStateService],
  exports: [RiskPolicyService, RiskProtectionService, RiskStateService],
})
export class RiskModule {}
