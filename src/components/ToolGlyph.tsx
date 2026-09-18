import { asLocalPngIcon, getToolIcon } from "../data/toolIcons";

export function ToolGlyph({
  icon,
  iconImage,
  className,
}: {
  icon?: string;
  iconImage?: string;
  className?: string;
}) {
  const image = asLocalPngIcon(iconImage);
  if (image) {
    return <img src={image} alt="" className={`${className ?? ""} object-contain`} draggable={false} />;
  }
  const Icon = getToolIcon(icon);
  return <Icon className={className} />;
}
