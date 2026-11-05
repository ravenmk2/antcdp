import type { ReactNode } from "react";
import { ArrowRight, Rocket } from "lucide-react";
import { Link } from "react-router";
import { StatusBadge } from "@/components/feedback";
import { StageFlow } from "@/components/stage-flow";
import { releaseStatus, resultTone } from "@/domain/labels";
import type { ProjectRelease } from "@/types/delivery";

export function ReleaseHero({
  release,
  href,
  heading,
  meta,
  action,
}: {
  release: ProjectRelease;
  href?: string;
  heading?: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="release-hero" aria-label="当前发布阶段">
      <div className="release-hero-top">
        <div className="release-identity">
          <span className="release-icon">
            <Rocket />
          </span>
          <div>
            <h2>
              {heading ?? (release.name || release.version_label)}
              <span className="mono release-version">
                {release.version_label}
              </span>
            </h2>
            <p>
              {release.variant_name} ·{" "}
              <span className="mono">{release.tag_name}</span>
              {meta ? <> · {meta}</> : null}
            </p>
          </div>
        </div>
        <div className="release-hero-actions">
          <StatusBadge tone={resultTone(release.status)}>
            {releaseStatus(release.status)}
          </StatusBadge>
          {href && (
            <Link className="button-secondary-small" to={href}>
              进入发布 <ArrowRight />
            </Link>
          )}
          {action}
        </div>
      </div>
      <StageFlow status={release.status} />
    </section>
  );
}
