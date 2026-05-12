import Image from "next/image";

type Props = {
  size?: number;
  className?: string;
};

export function Mark({ size = 28, className }: Props) {
  return (
    <Image
      src="/mark.png"
      alt="MPCKit"
      width={size}
      height={size}
      priority
      className={className}
      style={{ width: size, height: size }}
    />
  );
}
