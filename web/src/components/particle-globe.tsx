"use client";

import { OrbitControls, Stars } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { geoContains } from "d3-geo";
import { useMemo, useRef } from "react";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { Group } from "three";
import landTopology from "world-atlas/land-110m.json";

const topology = landTopology as unknown as Topology;
const land = feature(topology, topology.objects.land);

function seeded(seed: number) {
  const value = Math.sin(seed * 938.217 + 17.1) * 43758.5453;
  return value - Math.floor(value);
}

function positionFromCoordinates(latitude: number, longitude: number, radius: number) {
  const latitudeRadians = latitude * (Math.PI / 180);
  const longitudeRadians = longitude * (Math.PI / 180);
  return [
    radius * Math.cos(latitudeRadians) * Math.cos(longitudeRadians),
    radius * Math.sin(latitudeRadians),
    radius * Math.cos(latitudeRadians) * Math.sin(longitudeRadians),
  ];
}

function GlobePoints() {
  const group = useRef<Group>(null);
  const { landPositions, landColors, oceanPositions, oceanColors } = useMemo(() => {
    const landCount = 5600;
    const landPointPositions = new Float32Array(landCount * 3);
    const landPointColors = new Float32Array(landCount * 3);
    const oceanCount = 950;
    const oceanPointPositions = new Float32Array(oceanCount * 3);
    const oceanPointColors = new Float32Array(oceanCount * 3);

    let accepted = 0;
    let attempt = 1;
    while (accepted < landCount && attempt < landCount * 16) {
      const latitude = Math.asin(seeded(attempt * 3) * 2 - 1) * (180 / Math.PI);
      const longitude = seeded(attempt * 3 + 1) * 360 - 180;
      attempt += 1;

      if (!geoContains(land, [longitude, latitude])) continue;

      const cursor = accepted * 3;
      const [x, y, z] = positionFromCoordinates(latitude, longitude, 2.3 + seeded(attempt * 11) * 0.032);
      landPointPositions[cursor] = x;
      landPointPositions[cursor + 1] = y;
      landPointPositions[cursor + 2] = z;

      const warmMineral = seeded(attempt * 7) > 0.88;
      const icyLatitude = Math.abs(latitude) > 58;
      landPointColors[cursor] = icyLatitude ? 0.83 : warmMineral ? 0.95 : 0.39;
      landPointColors[cursor + 1] = icyLatitude ? 0.9 : warmMineral ? 0.78 : 0.94;
      landPointColors[cursor + 2] = icyLatitude ? 0.94 : warmMineral ? 0.58 : 0.78;
      accepted += 1;
    }

    for (let index = 0; index < oceanCount; index += 1) {
      const latitude = Math.asin(seeded(index * 17 + 4) * 2 - 1) * (180 / Math.PI);
      const longitude = seeded(index * 17 + 8) * 360 - 180;
      const cursor = index * 3;
      const [x, y, z] = positionFromCoordinates(latitude, longitude, 2.275);
      oceanPointPositions[cursor] = x;
      oceanPointPositions[cursor + 1] = y;
      oceanPointPositions[cursor + 2] = z;
      oceanPointColors[cursor] = 0.17;
      oceanPointColors[cursor + 1] = 0.36;
      oceanPointColors[cursor + 2] = 0.56;
    }

    return {
      landPositions: landPointPositions,
      landColors: landPointColors,
      oceanPositions: oceanPointPositions,
      oceanColors: oceanPointColors,
    };
  }, []);

  useFrame(({ clock }) => {
    if (group.current) {
      group.current.rotation.y = -1.22 + clock.getElapsedTime() * 0.018;
      group.current.rotation.x = -0.1;
    }
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[2.26, 64, 64]} />
        <meshBasicMaterial color="#07111a" transparent opacity={0.86} />
      </mesh>
      <points>
        <bufferGeometry>
          <bufferAttribute args={[oceanPositions, 3]} attach="attributes-position" />
          <bufferAttribute args={[oceanColors, 3]} attach="attributes-color" />
        </bufferGeometry>
        <pointsMaterial size={0.012} sizeAttenuation transparent opacity={0.52} vertexColors />
      </points>
      <points>
        <bufferGeometry>
          <bufferAttribute args={[landPositions, 3]} attach="attributes-position" />
          <bufferAttribute args={[landColors, 3]} attach="attributes-color" />
        </bufferGeometry>
        <pointsMaterial size={0.022} sizeAttenuation transparent opacity={0.96} vertexColors />
      </points>
    </group>
  );
}

export default function ParticleGlobe() {
  return (
    <div aria-label="Interactive particle globe showing the world's landmasses" className="particle-globe" role="img">
      <div className="particle-globe-backdrop" aria-hidden="true" />
      <Canvas camera={{ fov: 36, position: [0, 0, 9.2] }} dpr={[1, 1.5]}>
        <color attach="background" args={["#040506"]} />
        <ambientLight intensity={0.55} />
        <Stars count={360} depth={22} factor={1.1} radius={10} saturation={0} speed={0.06} />
        <GlobePoints />
        <OrbitControls enablePan={false} enableZoom={false} rotateSpeed={0.3} />
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.58} luminanceSmoothing={0.62} luminanceThreshold={0.14} mipmapBlur />
        </EffectComposer>
      </Canvas>
    </div>
  );
}
