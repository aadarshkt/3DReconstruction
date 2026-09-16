"use client";

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";

interface PointcloudViewerProps {
  plyUrl?: string;
  hasScan?: boolean;
}

export default function PointcloudViewer({ plyUrl, hasScan }: PointcloudViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameIdRef = useRef<number | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Clean any prior children
    container.innerHTML = "";

    const width = container.clientWidth || 600;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x181716);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
    camera.position.set(0, 3, 6);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;

    // Grid floor
    const grid = new THREE.GridHelper(10, 20, 0x5a554d, 0x2c2925);
    grid.position.y = -1;
    scene.add(grid);

    // Subtle axes helper
    const axes = new THREE.AxesHelper(1);
    scene.add(axes);

    let pointsMesh: THREE.Points | null = null;

    if (plyUrl) {
      const loader = new PLYLoader();
      loader.load(
        plyUrl,
        (geometry) => {
          geometry.computeVertexNormals();
          const hasColor = geometry.hasAttribute("color");
          const material = new THREE.PointsMaterial({
            size: 0.03,
            vertexColors: hasColor,
            color: hasColor ? undefined : 0xd97757,
          });
          pointsMesh = new THREE.Points(geometry, material);
          geometry.computeBoundingSphere();
          if (geometry.boundingSphere) {
            const center = geometry.boundingSphere.center;
            geometry.translate(-center.x, -center.y, -center.z);
          }
          scene.add(pointsMesh);
        },
        undefined,
        () => {
          // Fallback to procedural demo room point cloud
          createDemoRoomPointCloud(scene);
        }
      );
    } else {
      createDemoRoomPointCloud(scene);
    }

    function createDemoRoomPointCloud(targetScene: THREE.Scene) {
      const particleCount = 8000;
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      const colors = new Float32Array(particleCount * 3);

      // Procedural 4-wall room perimeter points
      for (let i = 0; i < particleCount; i++) {
        const wallChoice = Math.floor(Math.random() * 4);
        let x = 0, y = 0, z = 0;
        const w = 4.8;
        const d = 5.1;
        const h = 2.7;

        if (wallChoice === 0) {
          x = (Math.random() - 0.5) * w;
          z = -d / 2;
        } else if (wallChoice === 1) {
          x = (Math.random() - 0.5) * w;
          z = d / 2;
        } else if (wallChoice === 2) {
          x = -w / 2;
          z = (Math.random() - 0.5) * d;
        } else {
          x = w / 2;
          z = (Math.random() - 0.5) * d;
        }
        y = Math.random() * h - 1;

        // Slight noise
        x += (Math.random() - 0.5) * 0.08;
        z += (Math.random() - 0.5) * 0.08;

        positions[i * 3] = x;
        positions[i * 3 + 1] = y;
        positions[i * 3 + 2] = z;

        // Warm architectural hue
        colors[i * 3] = 0.85 + (Math.random() - 0.5) * 0.1;
        colors[i * 3 + 1] = 0.55 + (Math.random() - 0.5) * 0.1;
        colors[i * 3 + 2] = 0.40 + (Math.random() - 0.5) * 0.1;
      }

      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

      const material = new THREE.PointsMaterial({
        size: 0.035,
        vertexColors: true,
      });

      pointsMesh = new THREE.Points(geometry, material);
      targetScene.add(pointsMesh);
    }

    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.8;

    const animate = () => {
      animFrameIdRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [plyUrl, hasScan]);

  return (
    <div className="relative w-full h-[380px] sm:h-[440px] rounded-xl overflow-hidden border border-[var(--border-subtle)] bg-[#181716]">
      <div ref={mountRef} className="w-full h-full" />
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] text-[#A6A097] bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
        <span>Click & drag to rotate · Scroll to zoom · Right-click to pan</span>
        <span className="font-mono text-[#D97757]">Interactive 3D Dense Cloud</span>
      </div>
    </div>
  );
}
