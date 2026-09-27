import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../constants/metadata.constants';

/**
 * Marks a route as reachable without an access token. Authentication is
 * deny-by-default: every endpoint requires a valid JWT unless it opts out here.
 */
export const Public = (): CustomDecorator<string> => SetMetadata(IS_PUBLIC_KEY, true);
