import { describe, expect, it } from 'vitest';

import { isSeparatorChannelName, looksLikeEventTitle } from './channel-name.js';

describe('isSeparatorChannelName', () => {
  it.each([
    '-=Finland=-',
    '-= FINLAND =-',
    '── RUOTSI ──',
    '═══ SPORTS ═══',
    '*** FI ***',
    '## UK ENTERTAINMENT ##',
    '•• INFO ••',
    '>>> DOKUMENTIT <<<',
    '::::: NORDIC :::::',
    '____ PPV ____',
    '###',
    '────────',
    '**********',
  ])('flags separator %j', (name) => {
    expect(isSeparatorChannelName(name)).toBe(true);
  });

  it.each([
    'FI: Yle TV1 FHD',
    'SE: SVT1 HD',
    'Canal+',
    'E!',
    '24/7 Movies',
    '+1 Channel',
    'TV2.',
    'Yle Teema & Fem',
    'MTV3 (backup)',
    'BBC One',
    '(Ungrouped)',
    '19:30 HJK Helsinki - Inter Turku 8/5',
    '',
    '   ',
    '-',
  ])('keeps real channel name %j', (name) => {
    expect(isSeparatorChannelName(name)).toBe(false);
  });
});

describe('looksLikeEventTitle', () => {
  it.each([
    '17:00 Montreal ATP Tennis 8/5',
    '19.30 HJK Helsinki - Inter Turku',
    '23:45 NHL Pre-Season: TPS - KalPa 8/5',
    '9:00 Morning Show Special',
    '00:15 Late PPV',
  ])('flags event title %j', (name) => {
    expect(looksLikeEventTitle(name)).toBe(true);
  });

  it.each([
    'FI: Yle TV1 FHD',
    '24:00 Not a valid hour',
    '24/7 Movies',
    'Allsvenskan: Malmo FF - AIK (kick-off TBD)',
    '100:00 Nonsense',
    'Kanal 5 HD',
  ])('keeps non-event name %j', (name) => {
    expect(looksLikeEventTitle(name)).toBe(false);
  });
});
