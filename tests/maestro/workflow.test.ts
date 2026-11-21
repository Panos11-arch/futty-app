// .eas/workflows/e2e.yml (docs/testing/maestro.md): what makes it safe and
// cheap, checked without running it.
import fs from 'node:fs';
import path from 'node:path';

import { load } from 'js-yaml';

type Job = {
  type?: string;
  needs?: string[];
  environment?: string;
  runs_on?: string;
  params?: Record<string, unknown>;
  env?: Record<string, string>;
  steps?: { run?: string; uses?: string }[];
};
const file = path.join(__dirname, '..', '..', '.eas', 'workflows', 'e2e.yml');
const text = fs.readFileSync(file, 'utf8');
const workflow = load(text) as { on: Record<string, unknown>; jobs: Record<string, Job> };
const { jobs } = workflow;

describe('the e2e workflow', () => {
  it('runs only by hand (eas workflow:run .eas/workflows/e2e.yml), never on a pull request or push', () => {
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
    expect(text).not.toMatch(/^\s*(pull_request|push|schedule)\w*:/m);
  });

  it('never loads the production environment, and names no production project or live key', () => {
    for (const [name, job] of Object.entries(jobs)) {
      if (job.type === 'build') continue; // a build takes its profile's environment
      expect([name, job.environment]).toEqual([name, 'preview']);
    }
    expect(text).not.toMatch(/ospztpemchfpvvostisw|sk_live_|pk_live_|environment: production/);
  });

  it('checks the profile first: nothing builds or seeds before it passes', () => {
    expect(jobs.check_config.needs).toBeUndefined();
    expect(jobs.check_config.steps?.map((s) => s.run).join('\n')).toContain('scripts/e2e-seed/check-profile.ts');
    for (const name of ['seed', 'build_ios', 'build_android']) expect(jobs[name].needs).toEqual(['check_config']);
  });

  it('seeds before the tests, and hands them the slot', () => {
    expect(jobs.seed.steps?.map((s) => s.run ?? s.uses).join('\n')).toContain('scripts/e2e-seed/seed.ts');
    expect(jobs.maestro_ios.needs).toEqual(['build_ios', 'seed']);
    expect(jobs.maestro_android.needs).toEqual(['build_android', 'seed']);
    expect(jobs.maestro_ios.env?.MAESTRO_E2E_START).toBe('${{ needs.seed.outputs.ios_start }}');
    expect(jobs.maestro_android.env?.MAESTRO_E2E_START).toBe('${{ needs.seed.outputs.android_start }}');
  });

  it('builds both platforms with the e2e-test profile', () => {
    expect(jobs.build_ios).toMatchObject({ type: 'build', params: { platform: 'ios', profile: 'e2e-test' } });
    expect(jobs.build_android).toMatchObject({ type: 'build', params: { platform: 'android', profile: 'e2e-test' } });
  });

  it('runs the flows on each platform with its own logins, on the cheapest machines that can', () => {
    expect(jobs.maestro_ios).toMatchObject({
      type: 'maestro',
      runs_on: 'macos-medium',
      params: { build_id: '${{ needs.build_ios.outputs.build_id }}', flow_path: ['.maestro'] },
      env: { MAESTRO_E2E_PLATFORM: 'ios' },
    });
    expect(jobs.maestro_android).toMatchObject({
      type: 'maestro',
      runs_on: 'linux-medium-nested-virtualization',
      params: { build_id: '${{ needs.build_android.outputs.build_id }}', flow_path: ['.maestro'] },
      env: { MAESTRO_E2E_PLATFORM: 'android' },
    });
    for (const name of ['check_config', 'seed']) expect(jobs[name].runs_on).toBe('linux-medium');
  });

  it('holds no secret: the password comes from the environment', () => {
    expect(jobs.maestro_ios.env?.MAESTRO_E2E_PASSWORD).toBe('${{ env.STAGING_E2E_PASSWORD }}');
    expect(text).not.toMatch(/sb_secret_|sk_test_|eyJhbGci/);
  });

  it('fits Expo’s 16 KiB limit for a workflow file', () => {
    expect(Buffer.byteLength(text)).toBeLessThan(16 * 1024);
  });
});
