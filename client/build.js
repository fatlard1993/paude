import { buildClient } from '@vanilla-bean/components/app';

const { success } = await buildClient(process.env.NODE_ENV === 'production' ? { drop: ['console'] } : {});

if (!success) process.exit(1);
