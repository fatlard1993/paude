import os from 'os';
import { join } from 'path';

import readJsonFile from '../shared/readJsonFile';

// This machine's paude settings live in ~/.config/paude, beside the paude command's own
export const configFile = name => join(process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'), 'paude', name);

// { "shareRemotes": true } lets a password login see the other servers this machine is logged into, not just this
// machine's own logins. Read each time, so a change needs no restart.
export const serverSettings = () => readJsonFile(configFile('server.json'), {}).catch(() => ({}));
