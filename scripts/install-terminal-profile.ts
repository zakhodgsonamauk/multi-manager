import { ensureTerminalProfile } from '../src/launch/terminal-profile.ts';

const result = ensureTerminalProfile();
console.log(`${result.written ? 'Installed' : 'Already installed'}: ${result.path}`);
if (result.written) console.log('Restart Windows Terminal so it picks up the Multi-Manager profile.');
