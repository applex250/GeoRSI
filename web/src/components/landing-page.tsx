"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, GitFork, Mail, Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";
import { ThemeToggle } from "./theme-toggle";

const ParticleGlobe = dynamic(() => import("./particle-globe"), {
  ssr: false,
  loading: () => <div className="globe-loading" aria-hidden />,
});

const directions = [
  {
    number: "01",
    title: "Earth observation",
    text: "We connect satellite spectra, terrain structure, and field evidence to make maps that stay useful on the ground.",
  },
  {
    number: "02",
    title: "Computational earth",
    text: "Our models are built around uncertainty, reproducibility, and the uneven resolution of real geoscience data.",
  },
  {
    number: "03",
    title: "Research systems",
    text: "GeoRSI turns ambitious questions into traceable work graphs, evidence bundles, and measurable research runs.",
  },
];

const projects = [
  ["GEO RSI", "An interactive relative spectral index for hydrothermal alteration mapping.", "Remote sensing"],
  ["StrataNet", "A geospatial reasoning stack for multi-scale surface and subsurface evidence.", "Geocomputation"],
  ["Field archive", "Curated field observations with provenance designed for method evaluation.", "Open science"],
];

const navigation = [
  ["研究工作台", "/workspace"],
  ["About", "#about"],
  ["Research", "#research"],
  ["Team", "#team"],
  ["Projects", "#projects"],
  ["Join us", "#join"],
];

export function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  return (
    <main className="site-shell">
      <header className="site-header">
        <Link aria-label="Geobyte home" className="wordmark" href="/">
          geobyte
        </Link>
        <nav aria-label="Main navigation" className="desktop-nav">
          {navigation.map(([label, href]) => (
            <a href={href} key={href}>
              {label}
            </a>
          ))}
        </nav>
        <div className="header-actions">
          <ThemeToggle />
          <a className="contact-link" href="#contact">
            Contact
          </a>
          <a className="join-link" href="#join">
            Join the lab <ArrowUpRight aria-hidden size={15} strokeWidth={1.8} />
          </a>
          <button aria-expanded={menuOpen} aria-label="Toggle navigation" className="menu-button" onClick={() => setMenuOpen(!menuOpen)} type="button">
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <AnimatePresence>
          {menuOpen ? (
            <motion.nav
              animate={{ opacity: 1, y: 0 }}
              className="mobile-nav"
              exit={{ opacity: 0, y: -12 }}
              initial={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2 }}
            >
              {navigation.map(([label, href]) => (
                <a href={href} key={href} onClick={() => setMenuOpen(false)}>
                  {label}
                </a>
              ))}
            </motion.nav>
          ) : null}
        </AnimatePresence>
      </header>

      <section className="hero" id="top">
        <motion.p
          animate={{ opacity: 1, y: 0 }}
          className="hero-word hero-word-left"
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 20 }}
          transition={{ delay: 0.18, duration: 0.65 }}
        >
          GEO
        </motion.p>
        <motion.p
          animate={{ opacity: 1, y: 0 }}
          className="hero-word hero-word-right"
          initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 20 }}
          transition={{ delay: 0.26, duration: 0.65 }}
        >
          BYTE
        </motion.p>
        <motion.div
          animate={{ opacity: 1, scale: 1 }}
          className="hero-globe"
          initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.94 }}
          transition={{ delay: 0.06, duration: 0.85 }}
        >
          <ParticleGlobe />
        </motion.div>
        <p className="hero-scroll">
          Scroll to explore <ArrowDown aria-hidden size={15} strokeWidth={1.5} />
        </p>
        <Link className="rsi-link" href="/geo-rsi">
          GEO RSI <ArrowUpRight aria-hidden size={15} strokeWidth={1.7} />
        </Link>
      </section>

      <section className="intro-section" id="about">
        <div className="section-index">01 / About</div>
        <div className="intro-copy">
          <p className="intro-lede">
            Geobyte is a research lab for the difficult overlap of physical terrain, uncertain data, and computational systems.
          </p>
          <p>
            We make tools that move from remote observation to a clear, inspectable decision. The lab is intentionally small: field thinking, scientific methods, and software live in the same room.
          </p>
        </div>
      </section>

      <section className="directions-section" id="research">
        <div className="section-heading">
          <span className="section-index">02 / Research</span>
          <h2>Methods should be as legible as their results.</h2>
        </div>
        <div className="direction-list">
          {directions.map((direction) => (
            <article className="direction-row" key={direction.number}>
              <span>{direction.number}</span>
              <h3>{direction.title}</h3>
              <p>{direction.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="statement-section" id="team">
        <p className="section-index">03 / The lab</p>
        <p className="statement">
          Our team pairs geologists, remote-sensing researchers, and systems engineers around a single practice: make the path from raw signal to scientific claim visible.
        </p>
      </section>

      <section className="projects-section" id="projects">
        <div className="section-heading compact-heading">
          <span className="section-index">04 / Projects</span>
          <h2>Tools for a more inspectable earth science.</h2>
        </div>
        <div className="project-list">
          {projects.map(([title, description, kind]) => (
            <article className="project-row" key={title}>
              <span className="project-kind">{kind}</span>
              <div>
                <h3>{title}</h3>
                <p>{description}</p>
              </div>
              <ArrowUpRight aria-hidden className="project-arrow" size={21} strokeWidth={1.5} />
            </article>
          ))}
        </div>
      </section>

      <section className="join-section" id="join">
        <p className="section-index">05 / Work with us</p>
        <div>
          <h2>Bring a hard earth question.</h2>
          <p>We welcome collaborations that require careful data, open methods, and patient interpretation.</p>
          <a className="primary-action" href="mailto:hello@geobyte.lab">
            Start a conversation <ArrowUpRight aria-hidden size={17} strokeWidth={1.8} />
          </a>
        </div>
      </section>

      <footer className="site-footer" id="contact">
        <span>Geobyte Lab © 2026</span>
        <div>
          <a aria-label="Email Geobyte Lab" href="mailto:hello@geobyte.lab">
            <Mail size={17} strokeWidth={1.6} />
          </a>
          <a aria-label="Geobyte Lab on GitHub" href="https://github.com/applex250/geobyte-site" rel="noreferrer" target="_blank">
            <GitFork size={17} strokeWidth={1.6} />
          </a>
        </div>
        <span>Geoscience × computation</span>
      </footer>
    </main>
  );
}
