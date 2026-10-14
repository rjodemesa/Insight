"use client";

import { useSearchParams } from "next/navigation";
import { PERSONA_DASHBOARDS, PERSONA_PARAM, personaFrom } from "@/lib/personas";

/** "Dashboard - Overview", or the persona's name when one is picked in Views. */
export default function DashboardTitle() {
  const persona = personaFrom(useSearchParams().get(PERSONA_PARAM));
  return <h1 className="text-2xl font-semibold">Dashboard - {persona ? PERSONA_DASHBOARDS[persona].title : "Overview"}</h1>;
}
