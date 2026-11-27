import Image from "next/image";

type EnvelopeProps = {
  className?: string;
  outline?: boolean;
};

export function Envelope({ className = "", outline = false }: EnvelopeProps) {
  return (
    <Image
      src={outline ? "/envelope-outline.svg" : "/envelope.svg"}
      alt=""
      aria-hidden="true"
      width={640}
      height={420}
      unoptimized
      className={`envelope-image ${className}`}
    />
  );
}
