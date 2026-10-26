// # Validates one credential method and one action without permitting mass assignment.
import {
  IsIn,
  IsString,
  Length,
  Matches,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { STEP_UP_ACTIONS, type StepUpAction, type StepUpMethod } from '@wlct/shared-types';

@ValidatorConstraint({ name: 'stepUpCredentialMatchesMethod', async: false })
class StepUpCredentialMatchesMethod implements ValidatorConstraintInterface {
  validate(method: StepUpMethod, args: ValidationArguments): boolean {
    const dto = args.object as VerifyStepUpDto;
    const present = [
      dto.code !== undefined,
      dto.password !== undefined,
      dto.recoveryCode !== undefined,
    ];
    const expected = method === 'TOTP' ? 0 : method === 'PASSWORD' ? 1 : 2;
    return present.filter(Boolean).length === 1 && present[expected] === true;
  }

  defaultMessage(): string {
    return 'Provide exactly the credential field required by method.';
  }
}

export class VerifyStepUpDto {
  @IsIn(['TOTP', 'PASSWORD', 'RECOVERY_CODE'])
  @Validate(StepUpCredentialMatchesMethod)
  method!: StepUpMethod;

  @IsIn(STEP_UP_ACTIONS)
  action!: StepUpAction;

  @ValidateIf((value: VerifyStepUpDto) => value.method === 'TOTP')
  @IsString()
  @Matches(/^\d{6,8}$/)
  code?: string;

  @ValidateIf((value: VerifyStepUpDto) => value.method === 'PASSWORD')
  @IsString()
  @Length(1, 1024)
  password?: string;

  @ValidateIf((value: VerifyStepUpDto) => value.method === 'RECOVERY_CODE')
  @IsString()
  @Length(6, 64)
  recoveryCode?: string;
}
