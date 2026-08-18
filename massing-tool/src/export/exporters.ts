// Export / persistence.
//
// GLB export is the "make it pretty later" escape hatch: the massing exports
// as plain meshes that drop into Blender, Unreal, Unity, or any glTF-aware
// renderer. Model units are feet; pass meters=true (default in the UI) to
// scale to the glTF-standard meter on the way out.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import type { Building, SaveFile } from '../model/types';
import { BuildingView } from '../geometry/mesher';

const FEET_TO_METERS = 0.3048;

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportGLB(building: Building, meters: boolean): Promise<void> {
  const group = new BuildingView().buildExportGroup(building);
  if (meters) group.scale.multiplyScalar(FEET_TO_METERS);
  group.updateMatrixWorld(true);
  const exporter = new GLTFExporter();
  const result = (await exporter.parseAsync(group, { binary: true })) as ArrayBuffer;
  const name = (building.name || 'massing').replace(/[^\w-]+/g, '_');
  download(new Blob([result], { type: 'model/gltf-binary' }), `${name}.glb`);
}

export function saveJSON(file: SaveFile): void {
  const name = (file.building.name || 'massing').replace(/[^\w-]+/g, '_');
  download(
    new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }),
    `${name}.massing.json`,
  );
}

export function parseSaveFile(text: string): SaveFile {
  const data = JSON.parse(text) as SaveFile;
  if (data?.version !== 1 || !Array.isArray(data.building?.stack) || !data.building.stack.length) {
    throw new Error('Not a valid massing save file');
  }
  return data;
}
