import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

/** Strongly-typed ConfigService. Use `config.get('KEY', { infer: true })`. */
export type AppConfigService = ConfigService<EnvironmentVariables, true>;

export const API_PREFIX = 'api/v1';
