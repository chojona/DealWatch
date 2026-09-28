"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { ConfidenceDot } from "@/components/confidence-badge";
import type { AnalyzeThreadOutput } from "@/types";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";

const DEMO_THREAD = `From: Sarah Chen <s.chen@jllboston.com>
Date: September 22, 2026
Subject: 500 Atlantic — Riverside Partners Counter Proposal

Derek,

Following up on last week's tour. Riverside Partners is ready to move quickly on 500 Atlantic. Their revised proposal:

- 14,000 RSF, floors 12-13
- Term: 5 years
- Base rent: $58.00/RSF NNN with 2.5% annual bumps
- Free rent: 4 months
- TI allowance: $90/RSF
- Target commencement: February 1, 2027

Can you get us a counter by Friday September 27th? Riverside has another option they're evaluating in Fort Point and timing matters.

Sarah

---

From: Derek Hollis <d.hollis@atlanticproperties.com>
Date: September 23, 2026
Subject: Re: 500 Atlantic — Riverside Partners Counter Proposal

Sarah,

Thank you. This is a good opportunity. Our position:

- Rent: $61.00/RSF NNN, 3% bumps
- Free rent: 3 months (hard constraint)
- TI: $80/RSF — we can discuss if tenant is willing to go to 6 year term

The TI delta is significant. If Riverside goes to a 6-year term we would revisit TI at $95/RSF. 

I'll need our ownership to approve the 6-year scenario. I should have confirmation by end of week.

Derek`;

export function ThreadAnalyzer() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalyzeThreadOutput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleAnalyze() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSaved(false);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadText: text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!result) return;
    setSaving(true);
    try {
      const res = await fetch("/api/analyze", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadText: text, result }),
      });
      if (!res.ok) throw new Error("Save failed");
      setSaved(true);
    } catch {
      setError("Failed to save to database.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Input */}
      <div className="rounded-sm border border-zinc-200 bg-white p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-900">
            Paste Email Thread
          </h2>
          <button
            onClick={() => setText(DEMO_THREAD)}
            className="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
          >
            Load demo thread
          </button>
        </div>
        <Textarea
          placeholder="Paste a full email thread here — include sender, date, subject, and body for best results."
          className="min-h-[280px] font-mono text-xs resize-y"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between mt-3">
          <span className="text-[10px] text-zinc-400">
            {text.length > 0 ? `${text.length.toLocaleString()} characters` : ""}
          </span>
          <Button
            onClick={handleAnalyze}
            disabled={loading || !text.trim()}
            size="default"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Analyzing..." : "Analyze Thread"}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-900">
              Analysis Results
            </h2>
            <div className="flex items-center gap-2">
              {saved && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleSave}
                disabled={saving || saved}
              >
                {saving ? "Saving..." : saved ? "Saved" : "Save to Database"}
              </Button>
            </div>
          </div>

          <div className="rounded-sm border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700">
            <strong>Review before saving.</strong> These results were generated
            by an automated analysis stub. Verify each extracted obligation
            against the source thread before committing to your records.
          </div>

          {/* Deal info */}
          {(result.deal.company ||
            result.deal.property ||
            result.deal.stage) && (
            <div className="rounded-sm border border-zinc-200 bg-white p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">
                Deal Information
              </h3>
              <div className="grid grid-cols-3 gap-4">
                {result.deal.company && (
                  <div>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                      Company
                    </p>
                    <p className="text-sm text-zinc-800">{result.deal.company}</p>
                  </div>
                )}
                {result.deal.property && (
                  <div>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                      Property
                    </p>
                    <p className="text-sm text-zinc-800">{result.deal.property}</p>
                  </div>
                )}
                {result.deal.stage && (
                  <div>
                    <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                      Stage
                    </p>
                    <p className="text-sm text-zinc-800">{result.deal.stage}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Next action */}
          {result.nextAction && (
            <div className="rounded-sm border border-zinc-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Recommended Next Action
                </h3>
                <Badge
                  variant={
                    result.nextAction.urgency === "HIGH"
                      ? "high"
                      : result.nextAction.urgency === "MEDIUM"
                        ? "medium"
                        : "low"
                  }
                >
                  {result.nextAction.urgency}
                </Badge>
              </div>
              <p className="text-sm text-zinc-800">
                {result.nextAction.description}
              </p>
              <p className="text-xs text-zinc-400 mt-1">
                Owner: {result.nextAction.owner}
              </p>
            </div>
          )}

          {/* Obligations */}
          {result.obligations.length > 0 && (
            <div className="rounded-sm border border-zinc-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-100">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Detected Obligations ({result.obligations.length})
                </h3>
              </div>
              {result.obligations.map((obl, i) => (
                <div
                  key={i}
                  className="border-b border-zinc-100 last:border-0 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={obl.status} />
                        <span className="text-[10px] text-zinc-500 font-medium">
                          {obl.owner}
                          {obl.counterparty && (
                            <span className="text-zinc-300">
                              {" "}→ {obl.counterparty}
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-700">{obl.description}</p>
                      {obl.dueAt && (
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          Due: {obl.dueAt}
                        </p>
                      )}
                      <blockquote className="mt-1.5 text-[11px] text-zinc-400 italic border-l-2 border-zinc-200 pl-2">
                        &ldquo;{obl.evidenceQuote}&rdquo;
                      </blockquote>
                    </div>
                    <ConfidenceDot confidence={obl.confidence} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Events */}
          {result.events.length > 0 && (
            <div className="rounded-sm border border-zinc-200 bg-white overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-100">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Detected Events ({result.events.length})
                </h3>
              </div>
              {result.events.map((event, i) => (
                <div
                  key={i}
                  className="border-b border-zinc-100 last:border-0 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge variant="secondary">{event.type}</Badge>
                        {event.occurredAt && (
                          <span className="text-[10px] text-zinc-400">
                            {event.occurredAt}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-zinc-700">{event.description}</p>
                      <blockquote className="mt-1.5 text-[11px] text-zinc-400 italic border-l-2 border-zinc-200 pl-2">
                        &ldquo;{event.evidenceQuote}&rdquo;
                      </blockquote>
                    </div>
                    <ConfidenceDot confidence={event.confidence} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
