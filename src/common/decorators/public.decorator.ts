import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Opts a controller or route out of the global admin JWT guard. */
export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC_KEY, true);
