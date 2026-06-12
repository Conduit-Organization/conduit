import Reveal from "./Reveal";

/** Consistent eyebrow + display heading + lead used at the top of sections. */
export default function SectionHeader({
  eyebrow,
  title,
  lead,
  align = "left",
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  align?: "left" | "center";
  className?: string;
}) {
  const isCenter = align === "center";
  return (
    <div
      className={[
        isCenter ? "mx-auto text-center" : "",
        isCenter ? "max-w-2xl" : "max-w-3xl",
        className ?? "",
      ].join(" ")}
    >
      <Reveal>
        <span className="eyebrow">{eyebrow}</span>
      </Reveal>
      <Reveal delay={0.06}>
        <h2 className="display mt-3 text-[clamp(28px,4.4vw,46px)]">{title}</h2>
      </Reveal>
      {lead ? (
        <Reveal delay={0.12}>
          <p
            className={[
              "mt-4 text-[17px] leading-relaxed text-muted",
              isCenter ? "mx-auto" : "",
            ].join(" ")}
          >
            {lead}
          </p>
        </Reveal>
      ) : null}
    </div>
  );
}
