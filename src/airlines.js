// A short list of airlines seen most often, with the colour used on the tail. Anything else falls back to the receiver's own tables.
export const AIRLINES = {
  AAL: ['AA', 'American Airlines', 0x2a6ebb], DAL: ['DL', 'Delta Air Lines', 0xc8102e], UAL: ['UA', 'United Airlines', 0x1b4f9c],
  JBU: ['B6', 'JetBlue', 0x0a3fa8], SWA: ['WN', 'Southwest Airlines', 0xf2a900], NKS: ['NK', 'Spirit Airlines', 0xffe600],
  FFT: ['F9', 'Frontier Airlines', 0x1f8a4c], ASA: ['AS', 'Alaska Airlines', 0x0b3d5b], HAL: ['HA', 'Hawaiian Airlines', 0x6a2c91],
  AAY: ['G4', 'Allegiant Air', 0xf58220], SCX: ['SY', 'Sun Country Airlines', 0xf58220], MXY: ['MX', 'Breeze Airways', 0x2d6cdf],
  VXP: ['XP', 'Avelo Airlines', 0x5b2d8e], RPA: ['YX', 'Republic Airways', 0x8a94a0], EDV: ['9E', 'Endeavor Air', 0xc8102e],
  ENY: ['MQ', 'Envoy Air', 0x2a6ebb], JIA: ['OH', 'PSA Airlines', 0x2a6ebb], PDT: ['PT', 'Piedmont Airlines', 0x2a6ebb],
  SKW: ['OO', 'SkyWest Airlines', 0x7a8793], ASH: ['YV', 'Mesa Airlines', 0x7a8793], GJS: ['G7', 'GoJet Airlines', 0x1b4f9c],
  UCA: ['C5', 'CommuteAir', 0x1b4f9c], KAP: ['9K', 'Cape Air', 0x1c75bc], FDX: ['FX', 'FedEx', 0x4d148c], UPS: ['5X', 'UPS', 0x5a3a1e],
  GTI: ['5Y', 'Atlas Air', 0x1b3a6b], ABX: ['GB', 'ABX Air', 0x8a94a0], ATN: ['8C', 'Air Transport International', 0x8a94a0],
  ACA: ['AC', 'Air Canada', 0xd22630], JZA: ['QK', 'Jazz', 0xd22630], WJA: ['WS', 'WestJet', 0x00a9a5], POE: ['PD', 'Porter Airlines', 0x1d3557],
  BAW: ['BA', 'British Airways', 0x1d3f7a], VIR: ['VS', 'Virgin Atlantic', 0xc8102e], EIN: ['EI', 'Aer Lingus', 0x008a5e],
  DLH: ['LH', 'Lufthansa', 0x0a1d5c], AFR: ['AF', 'Air France', 0x1b3f8f], KLM: ['KL', 'KLM', 0x00a1de], SWR: ['LX', 'Swiss', 0xd22630],
  AUA: ['OS', 'Austrian Airlines', 0xd22630], BEL: ['SN', 'Brussels Airlines', 0x1b3f8f], IBE: ['IB', 'Iberia', 0xd22630],
  TAP: ['TP', 'TAP Air Portugal', 0x1f8a4c], ITY: ['AZ', 'ITA Airways', 0x0a3fa8], SAS: ['SK', 'SAS', 0x1b3a6b], FIN: ['AY', 'Finnair', 0x0b2a5b],
  ICE: ['FI', 'Icelandair', 0x0a2d6e], NOZ: ['DY', 'Norwegian', 0xd22630], LOT: ['LO', 'LOT Polish Airlines', 0x1b3f8f],
  THY: ['TK', 'Turkish Airlines', 0xc8102e], ELY: ['LY', 'El Al', 0x1b3f8f], UAE: ['EK', 'Emirates', 0xc8102e], QTR: ['QR', 'Qatar Airways', 0x6d0f3a],
  ETD: ['EY', 'Etihad Airways', 0xb8975a], SVA: ['SV', 'Saudia', 0x1f8a4c], RJA: ['RJ', 'Royal Jordanian', 0x3a3a3a], MSR: ['MS', 'EgyptAir', 0x1b3a6b],
  ETH: ['ET', 'Ethiopian Airlines', 0x1f8a4c], RAM: ['AT', 'Royal Air Maroc', 0xc8102e], AIC: ['AI', 'Air India', 0xc8102e],
  CPA: ['CX', 'Cathay Pacific', 0x00645a], SIA: ['SQ', 'Singapore Airlines', 0x1b3a6b], JAL: ['JL', 'Japan Airlines', 0xc8102e],
  ANA: ['NH', 'All Nippon Airways', 0x1b4f9c], KAL: ['KE', 'Korean Air', 0x6fb7d9], AAR: ['OZ', 'Asiana Airlines', 0x8a94a0],
  CCA: ['CA', 'Air China', 0xc8102e], CES: ['MU', 'China Eastern', 0x1b3f8f], CSN: ['CZ', 'China Southern', 0x00a1de], EVA: ['BR', 'EVA Air', 0x1f8a4c],
  CAL: ['CI', 'China Airlines', 0x6a2c91], QFA: ['QF', 'Qantas', 0xd22630], ANZ: ['NZ', 'Air New Zealand', 0x1c1c1c],
  AMX: ['AM', 'Aeromexico', 0x0b2a5b], VOI: ['Y4', 'Volaris', 0x6a2c91], AVA: ['AV', 'Avianca', 0xd22630], CMP: ['CM', 'Copa Airlines', 0x1b4f9c],
  TAM: ['LA', 'LATAM', 0x1b1464], LAN: ['LA', 'LATAM', 0x1b1464], AZU: ['AD', 'Azul', 0x0a3fa8], BWA: ['BW', 'Caribbean Airlines', 0x00a1de],
  EJA: ['', 'NetJets', 0x3a3a3a], LXJ: ['', 'Flexjet', 0x7a1f2b], JRE: ['', 'flyExclusive', 0x3a3a3a], EJM: ['', 'Executive Jet Management', 0x3a3a3a],
  VJA: ['', 'Vista America', 0xb0b0b0], TWY: ['', 'Sun Air Jets', 0x3a3a3a], XOJ: ['', 'XOJET', 0x3a3a3a], WUP: ['', 'Wheels Up', 0x1b3a6b],
  NBT: ['N0', 'Norse Atlantic Airways', 0x1d2a44], TSC: ['TS', 'Air Transat', 0x1a8fd6], CLX: ['CV', 'Cargolux', 0xe2001a], CKS: ['K4', 'Kalitta Air', 0xb8232f],
  PAC: ['PO', 'Polar Air Cargo', 0x1b3a6b], KAC: ['KU', 'Kuwait Airways', 0x0055a4], AEA: ['UX', 'Air Europa', 0x0066cc], DJT: ['B0', 'La Compagnie', 0x7ec8e3],
  FBU: ['BF', 'French bee', 0x0055a4], VIV: ['VB', 'Viva Aerobus', 0x00a651], CFG: ['DE', 'Condor', 0xffad00], KQA: ['KQ', 'Kenya Airways', 0xe2001a],
  CNS: ['', 'PlaneSense', 0x1b4f9c], LBQ: ['', 'Quest Diagnostics', 0x1f8a4c], TIV: ['', 'Tradewind Aviation', 0x1b4f9c], BTQ: ['', 'Blade', 0x1c1c1c],
};
export const IATA2ICAO = {};
for (const k of Object.keys(AIRLINES)) { const i = AIRLINES[k][0]; if (i && !IATA2ICAO[i]) IATA2ICAO[i] = k; }

// ---------- paint ----------
// Paint by zones. No logos and no lettering: colours only, laid out the way each airline lays them out.
// Zones: top (upper body), belly, stripe (a band at window height), aft (rear body), tail (one colour, or three from bottom to top),
// eng (engines), wing, tip (wing tips). Anything left out falls back to white, with wings in light grey.
const W = 0xf4f5f5, GREY = 0xc9ced4, GLASS = 0x1b222c;
export const LIVERY = {
  AAL: { top: 0xc3c8ce, wing: 0xb4bac1, eng: 0xc3c8ce, tail: [0xb5202e, 0xdfe3e8, 0x1f4e8c], tip: 0xc3c8ce },            // silver body, red, white and blue tail
  DAL: { belly: 0x0b2a5b, eng: 0x0b2a5b, tail: [0x0b2a5b, 0xc01933, 0xe0263a], tip: 0x0b2a5b },                          // dark blue belly and engines, red on a blue tail
  UAL: { stripe: 0x5b9bd5, belly: 0xb9bfc6, eng: 0x0a3a8c, tail: [0x0a3a8c, 0x0a3a8c, 0x2f6fd0], tip: 0x0a3a8c },        // blue tail and engines, grey belly under a sky blue line
  JBU: { eng: 0x0a2f6b, tail: [0x0a2f6b, 0x0f52ba, 0x0f52ba], tip: 0x0f52ba },
  SWA: { top: 0x304cb2, eng: 0x304cb2, tail: [0xffbf27, 0xd5152e, 0x304cb2], tip: 0xd5152e },                           // blue all over, yellow and red sweeping up the tail
  NKS: { top: 0xffe600, eng: 0xffe600, tail: 0xffe600, tip: 0x1c1c1c },                                                  // yellow all over
  FFT: { stripe: 0x1f8a4c, tail: [0x1f8a4c, 0xe6ebe6, 0xe6ebe6], tip: 0x1f8a4c },
  ASA: { aft: 0x0b3d5b, eng: 0x0b3d5b, tail: 0x0b3d5b, tip: 0x0b3d5b },
  HAL: { aft: 0x413691, tail: [0x413691, 0x8b2f8f, 0xc7347f], tip: 0x413691 },
  AAY: { eng: 0x02569b, tail: [0x02569b, 0x02569b, 0xf9a01b], tip: 0x02569b },
  SCX: { tail: [0x00407a, 0x00407a, 0xf58220], tip: 0xf58220 },
  VXP: { tail: [0x5b2d8e, 0x5b2d8e, 0xf2c300], eng: 0x5b2d8e, tip: 0x5b2d8e },
  FDX: { tail: 0x4d148c, eng: 0xe4e6e9, tip: 0x4d148c },
  UPS: { stripe: 0x4a2c1a, belly: 0xd3d6d9, aft: 0x351c15, tail: [0x351c15, 0xffb500, 0x351c15] },
  ACA: { belly: 0x1a1a1a, eng: 0x1a1a1a, tail: [0x1a1a1a, 0xd22630, 0x1a1a1a], tip: 0x1a1a1a },                          // black belly, engines and tail, red on the tail
  WJA: { tail: [0x17365d, 0x00a9a5, 0x00a9a5], tip: 0x00a9a5 },
  POE: { tail: 0x1d3557, tip: 0x1d3557 },
  BAW: { belly: 0x10214b, eng: 0x10214b, tail: [0x10214b, 0xc8102e, 0xe9edf2] },
  VIR: { eng: 0xd5152e, tail: 0xd5152e, tip: 0xd5152e },
  EIN: { belly: 0x006272, eng: 0x006272, tail: 0x006272, tip: 0x006272 },
  DLH: { aft: 0x05164d, tail: 0x05164d },
  AFR: { tail: [0x0a2a6b, 0x0a2a6b, 0xe1000f] },
  KLM: { top: 0x00a1de, stripe: 0x003a70, belly: 0xe4e7ea, eng: 0x00a1de, tail: [W, W, 0x00a1de] },
  SWR: { tail: 0xd52b1e },
  IBE: { tail: [0xd7192d, 0xd7192d, 0xfab800] },
  TAP: { tail: [0xd22630, 0x3f9c35, 0x3f9c35] },
  ITY: { top: 0x1e5aa8, eng: 0x1e5aa8, tail: 0x1e5aa8, tip: 0x1e5aa8 },
  FIN: { tail: [W, 0x0b2a5b, W] },
  THY: { belly: 0xcfd3d7, tail: 0xc8102e },
  UAE: { tail: [0xd71a21, W, 0x00843d] },
  QTR: { top: 0xd3d5d8, eng: 0xd3d5d8, tail: 0x5c0632 },
  ETD: { top: 0xcdb991, eng: 0xcdb991, tail: [0x8a6d3b, 0xbd9b60, 0x6b4f2a] },
  CPA: { stripe: 0x00645a, belly: 0xd9dde1, tail: 0x00645a },
  SIA: { stripe: 0x1b3a6b, tail: [0x1b3a6b, 0xf2a900, 0x1b3a6b] },
  JAL: { tail: [W, 0xc8102e, W] },
  ANA: { stripe: 0x13448f, belly: 0xd9dde1, tail: [0x13448f, 0x13448f, 0x4ea5d9] },
  KAL: { top: 0x7cb9de, belly: 0xe2e6ea, eng: 0xe2e6ea, tail: 0x7cb9de },
  CCA: { stripe: 0x1b3f8f, belly: 0xd0d4d8, tail: [W, 0xc8102e, W] },
  CSN: { stripe: 0x0080c8, tail: [0x0080c8, 0xc8102e, 0x0080c8] },
  EVA: { stripe: 0x00674b, tail: 0x00674b },
  QFA: { aft: 0xe40000, tail: 0xe40000 },
  ANZ: { aft: 0x1c1c1c, tail: 0x1c1c1c },
  AVA: { top: 0xda291c, tail: 0xda291c, eng: 0xda291c },
  TAM: { aft: 0x1b1464, eng: 0x1b1464, tail: [0x1b1464, 0x1b1464, 0xed1650] },
};
LIVERY.LAN = LIVERY.TAM;
// Regional airlines that always fly in one partner's colours. Republic, SkyWest and Mesa fly for several airlines and the
// callsign does not say which, so they stay neutral.
const PAINT_AS = { EDV: 'DAL', ENY: 'AAL', JIA: 'AAL', PDT: 'AAL', GJS: 'UAL', UCA: 'UAL', JZA: 'ACA' };
const GA = [0xb5202e, 0x1f4e8c, 0x7a1f2b, 0x1f6a4c, 0x1c1c1c, 0xc46a1b];   // small private aircraft: white with one trim colour

// The list of colours for one aircraft, in the order of ZONES in scene.js.
export function paintFor(callsign, hexId, kind) {
  const cs = (callsign || '').trim(), key = /^[A-Z]{3}\d/.test(cs) ? cs.slice(0, 3) : '';
  let r = LIVERY[PAINT_AS[key] || key];
  if (!r) {
    const al = key && AIRLINES[key];
    if (al) r = { tail: al[2], eng: al[2] };                                   // an airline we know only by one colour
    else if (kind === 'light' || kind === 'heli') { let h = 0; for (const c of hexId || '') h = (h * 31 + c.charCodeAt(0)) >>> 0; const c = GA[h % GA.length]; r = { stripe: c, tail: c, tip: c }; }
    else r = { tail: 0x8fa3b8, eng: 0xdfe2e6 };                                // unknown: plain white with a grey tail
  }
  const top = r.top != null ? r.top : W, tail = Array.isArray(r.tail) ? r.tail : [r.tail != null ? r.tail : top, r.tail != null ? r.tail : top, r.tail != null ? r.tail : top];
  const or = (v, d) => (v != null ? v : d);
  return [top, or(r.belly, top), or(r.stripe, top), or(r.aft, top), GLASS, or(r.wing, GREY), or(r.eng, W), or(r.tip, top), tail[0], tail[1], tail[2]];
}
