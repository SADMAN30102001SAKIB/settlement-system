import type { createDatabase } from '@settlement/database';

export interface AppEnvironment {
  Bindings: Env;
  Variables: {
    database: () => ReturnType<typeof createDatabase>;
    username: string;
  };
}
