import { sectionNames } from "../navigation";

export const dynamicParams = false;
export function generateStaticParams() {
  return sectionNames.map((section) => ({ section }));
}

export default function SectionPage() {
  return null;
}
