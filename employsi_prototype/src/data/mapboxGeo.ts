// Approximate real-world Perth CBD coordinates for each company, replacing
// the old arbitrary Three.js grid units now that the scene is a real map.
export const PERTH_CENTER: [number, number] = [115.8592, -31.9535];
export const PERTH_DEFAULT_ZOOM = 15.6;
export const PERTH_DEFAULT_PITCH = 60;
export const PERTH_DEFAULT_BEARING = -17.6;

export const COMPANY_COORDS: Record<string, [number, number]> = {
  rio: [115.8578, -31.9525], // Central Park Tower, 152-158 St Georges Tce
  bhp: [115.8565, -31.9538], // BHP Tower, 125 St Georges Tce
  s32: [115.8595, -31.953], // St Georges Tce
  fmg: [115.865, -31.9553], // Fortescue Centre, 87 Adelaide Tce
  wds: [115.8495, -31.9518], // Mia Yellagonga, 11 Mount St
  sto: [115.8615, -31.9548], // St Georges Tce
  sfr: [115.858, -31.9695], // South Perth foreshore
  igo: [115.866, -31.9705], // South Perth / Victoria Park
};
