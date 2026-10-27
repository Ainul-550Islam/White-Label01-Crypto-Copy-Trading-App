import { NextRequest } from 'next/server';
import { recoveryBff } from '@/features/security/recovery-bff';
export const dynamic = 'force-dynamic';
export function POST(request: NextRequest) { return recoveryBff(request, 'verify'); }
