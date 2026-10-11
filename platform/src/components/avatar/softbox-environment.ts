import { BackSide, BoxGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';

import type { SoftboxEnvironment } from './lighting';

/**
 * Сцена-окружение «фотостудия» для PMREMGenerator.fromScene: тёмная комната (BackSide) и светящиеся
 * панели-софтбоксы, развёрнутые к центру. Металл отражает прежде всего окружение, а не направленные
 * лампы, поэтому тень на металле получается только если в окружении есть тёмная сторона –
 * RoomEnvironment светлый со всех сторон. Приём тот же, что в RoomEnvironment: яркость панели –
 * цвет MeshBasicMaterial больше единицы.
 */
export function buildSoftboxScene(spec: SoftboxEnvironment): {
  scene: Scene;
  dispose: () => void;
} {
  const scene = new Scene();
  const geometry = new BoxGeometry();
  const materials: MeshBasicMaterial[] = [];

  const roomMaterial = new MeshBasicMaterial({ side: BackSide });
  roomMaterial.color.setScalar(spec.wall);
  materials.push(roomMaterial);
  const room = new Mesh(geometry, roomMaterial);
  room.scale.setScalar(40);
  scene.add(room);

  for (const box of spec.softboxes) {
    const material = new MeshBasicMaterial();
    material.color.setScalar(box.intensity);
    materials.push(material);
    const panel = new Mesh(geometry, material);
    panel.position.set(...box.position);
    panel.scale.set(box.size[0], box.size[1], 0.1);
    panel.lookAt(0, 0, 0);
    scene.add(panel);
  }

  return {
    scene,
    dispose: () => {
      geometry.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
