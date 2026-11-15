import type { PostgrestError } from '@supabase/supabase-js';

import { describeSquadError } from './squad-errors';

const error = (message: string) => ({ message }) as PostgrestError;

describe('describeSquadError: Gipedo Pano offers (P8)', () => {
  it.each(['already_in_booking', 'cannot_rejoin', 'use_gipedo_pull_out', 'post_closed', 'not_captain'])(
    '%s has a message',
    (code) => {
      expect(describeSquadError(error(code))).not.toBe(code);
    },
  );
});
