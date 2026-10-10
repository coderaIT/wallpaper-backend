import { ExecutionContext, SetMetadata } from '@nestjs/common';

export type ThrottleProfile = 'auth' | 'events';

export const THROTTLE_PROFILE_KEY = 'throttleProfile';

/**
 * Applies an additional, stricter named throttler (configured from env in AppModule) to a
 * route or controller, on top of the global default limit.
 */
export const UseThrottleProfile = (profile: ThrottleProfile): ClassDecorator & MethodDecorator =>
  SetMetadata(THROTTLE_PROFILE_KEY, profile);

export function getThrottleProfile(context: ExecutionContext): ThrottleProfile | undefined {
  const fromHandler = Reflect.getMetadata(THROTTLE_PROFILE_KEY, context.getHandler()) as
    | ThrottleProfile
    | undefined;
  return (
    fromHandler ??
    (Reflect.getMetadata(THROTTLE_PROFILE_KEY, context.getClass()) as ThrottleProfile | undefined)
  );
}
