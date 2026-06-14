/**
 * Three.js viewport. The kernel lib emits mesh data; Three owns rendering (never the
 * other way round). Given BufferGeometry-ready typed arrays + a bbox, it shows the
 * part and frames the camera. Orbit / pan / zoom via OrbitControls.
 */
import {
  Scene,
  Color,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  BufferGeometry,
  BufferAttribute,
  EdgesGeometry,
  LineSegments,
  LineBasicMaterial,
  GridHelper,
  Group,
  Vector3,
  ACESFilmicToneMapping,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { GeometryPayload } from "../kernel/protocol";

function cssColor(name: string, fallback: string): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new Color(v || fallback).getHex();
}

export class Viewport {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly part = new Group();
  private readonly material: MeshStandardMaterial;
  private grid: GridHelper | null = null;

  constructor(private readonly container: HTMLElement) {
    this.scene.background = new Color(cssColor("--surface-0", "#16161a"));

    this.camera = new PerspectiveCamera(45, 1, 0.1, 100_000);
    this.camera.position.set(80, 60, 80);

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // Lighting — read enough geometry without a heavy environment map.
    const hemi = new HemisphereLight(0xffffff, 0x2a2a30, 1.05);
    this.scene.add(hemi);
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(1, 1.4, 0.8);
    this.scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.5);
    fill.position.set(-1, 0.3, -0.7);
    this.scene.add(fill);

    this.material = new MeshStandardMaterial({
      color: 0xb9bdc6,
      metalness: 0.18,
      roughness: 0.55,
    });

    this.scene.add(this.part);

    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.resize();
    this.loop();
  }

  /** Re-read themed colours (called on light/dark toggle). */
  refreshTheme(): void {
    this.scene.background = new Color(cssColor("--surface-0", "#16161a"));
  }

  /** Replace the displayed part with new geometry and frame the camera to it. */
  setGeometry(g: GeometryPayload): void {
    this.clearPart();

    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(g.position, 3));
    geo.setAttribute("normal", new BufferAttribute(g.normal, 3));
    geo.setIndex(new BufferAttribute(g.index, 1));

    const mesh = new Mesh(geo, this.material);
    this.part.add(mesh);

    // Crisp CAD edges over the shaded solid.
    const edges = new EdgesGeometry(geo, 25);
    const lines = new LineSegments(
      edges,
      new LineBasicMaterial({ color: cssColor("--accent-dim", "#a36f2c") }),
    );
    this.part.add(lines);

    this.placeGrid(g);
    this.frame(g.bbox);
  }

  private placeGrid(g: GeometryPayload): void {
    if (this.grid) this.scene.remove(this.grid);
    const span = Math.max(
      g.bbox.max[0] - g.bbox.min[0],
      g.bbox.max[1] - g.bbox.min[1],
      g.bbox.max[2] - g.bbox.min[2],
      10,
    );
    const size = Math.ceil((span * 3) / 10) * 10;
    this.grid = new GridHelper(size, size / 10, 0x33333c, 0x26262d);
    // brepjs/OCCT is Z-up; rotate the XZ grid helper onto XY and drop to z=min.
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = g.bbox.min[2];
    this.scene.add(this.grid);
  }

  private frame(bbox: GeometryPayload["bbox"]): void {
    const center = new Vector3(
      (bbox.min[0] + bbox.max[0]) / 2,
      (bbox.min[1] + bbox.max[1]) / 2,
      (bbox.min[2] + bbox.max[2]) / 2,
    );
    const size = new Vector3(
      bbox.max[0] - bbox.min[0],
      bbox.max[1] - bbox.min[1],
      bbox.max[2] - bbox.min[2],
    );
    const radius = Math.max(size.length() / 2, 1);
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 180 / 2);

    this.camera.position.copy(center).add(new Vector3(1, 0.8, 1).normalize().multiplyScalar(dist * 1.3));
    this.camera.near = dist / 100;
    this.camera.far = dist * 100;
    this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 0, 1); // Z-up to match the kernel
    this.controls.target.copy(center);
    this.controls.update();
  }

  private clearPart(): void {
    for (const child of [...this.part.children]) {
      this.part.remove(child);
      const obj = child as Mesh | LineSegments;
      obj.geometry?.dispose();
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };
}
