'use client';
import type { JSX } from 'react';
import { DeveloperI18n, useDeveloperI18n } from '@/features/developer/i18n';
import { StepUpDialog } from '@/features/developer/step-up-dialog';
import type { StepUpMethod } from '@/api/developer-platform-api';

const description = {
  en: 'Confirm your identity to change this plan.',
  bn: 'এই পরিকল্পনা পরিবর্তন করতে আপনার পরিচয় নিশ্চিত করুন।',
  ar: 'أكد هويتك لتغيير هذه الخطة.',
  es: 'Confirma tu identidad para cambiar este plan.',
  tr: 'Bu planı değiştirmek için kimliğinizi doğrulayın.',
} as const;
function LocalizedDialog(props: { busy: boolean; failed: boolean; onCancel: () => void; onVerify: (method: StepUpMethod, value: string) => Promise<void> }): JSX.Element {
  const { locale, t } = useDeveloperI18n();
  return <StepUpDialog description={description[locale]} busy={props.busy} error={props.failed ? t.verificationFailed : ''} onCancel={props.onCancel} onVerify={props.onVerify} />;
}
export function PlanStepUpDialog(props: { busy: boolean; failed: boolean; onCancel: () => void; onVerify: (method: StepUpMethod, value: string) => Promise<void> }): JSX.Element {
  return <DeveloperI18n><LocalizedDialog {...props} /></DeveloperI18n>;
}
