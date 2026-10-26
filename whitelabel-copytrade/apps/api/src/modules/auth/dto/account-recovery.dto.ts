// # Responsibility: validates the three recovery steps strictly, so a malformed token or a stray field never reaches the recovery service.
//
// The recovery endpoints are unauthenticated. A body that carries anything the
// service does not expect is a bug in a client or an attempt to reach a field
// that decides identity, so `forbidNonWhitelisted` turns both into a 422 rather
// than a silent ignore.
import { IsEmail, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class RequestAccountRecoveryDto {
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(254)
  email!: string;

  /**
   * Optional tenant slug. Accepted because a white-label customer may know their
   * operator's name but not their tenant id, and it makes a same-address-in-two-
   * tenants case resolvable. It never widens which token can match.
   */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  tenantSlug?: string;
}

export class VerifyAccountRecoveryDto {
  /** Base64url token from the emailed link. Bounded so an enormous body is refused early. */
  @IsString()
  @Length(16, 256, { message: 'That recovery link is not valid' })
  token!: string;
}

export class CompleteAccountRecoveryDto {
  @IsString()
  @Length(16, 256, { message: 'That recovery link is not valid' })
  token!: string;

  /**
   * The new password. Validated for length here and for strength by the existing
   * password service - this DTO deliberately does not re-implement the policy,
   * because two sources of truth for password strength is how one of them ends up
   * weaker than the other.
   */
  @IsString()
  @Length(12, 128, { message: 'Use at least 12 characters for your new password' })
  newPassword!: string;
}
