import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'qyou:is-public';

/** Opts a route out of the global session requirement. Routes are authenticated by default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
