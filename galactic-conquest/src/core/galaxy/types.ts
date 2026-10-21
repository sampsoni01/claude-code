export type SpecialKind = 'none' | 'black-hole' | 'pulsar' | 'nebula-heart';
export type StarType = 'yellow' | 'orange' | 'red-dwarf' | 'white' | 'blue-giant' | 'binary';
export type LaneKind = 'normal' | 'shortcut';

export interface StarSystem {
  id: number;
  /** Placeholder until the name generator exists. */
  name: string;
  sector: number;
  x: number;
  y: number;
  star: StarType;
  planets: number;
  pois: number;
  special: SpecialKind;
  inNebula: boolean;
  /** Lane ids touching this system. */
  lanes: number[];
  /** Suitable as a faction home system. */
  startCandidate: boolean;
}

export interface Lane {
  id: number;
  a: number;
  b: number;
  length: number;
  kind: LaneKind;
  /** Joins two different sectors. These are the chokepoints. */
  intersector: boolean;
}

export interface Sector {
  id: number;
  name: string;
  cx: number;
  cy: number;
  systems: number[];
}

export interface Nebula {
  id: number;
  center: number;
  radius: number;
  systems: number[];
}

export interface Galaxy {
  seed: string;
  width: number;
  height: number;
  systems: StarSystem[];
  lanes: Lane[];
  sectors: Sector[];
  nebulae: Nebula[];
}

export interface GalaxyConfig {
  seed: string;
  /** 80 to 150 in the brief. */
  systems: number;
  /** Home systems to reserve: the player plus the rivals. */
  starts?: number;
}
