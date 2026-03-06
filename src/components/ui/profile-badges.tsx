import { BadgeCheck, Crown } from "lucide-react";

interface ProfileBadgesProps {
  isPremium?: boolean;
  isVerified?: boolean;
  size?: number;
}

export function ProfileBadges({ isPremium = false, isVerified = false, size = 14 }: ProfileBadgesProps) {
  if (!isPremium && !isVerified) return null;

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {isPremium && <Crown size={size} className="text-amber-300" aria-label="Premium" />}
      {isVerified && <BadgeCheck size={size} className="text-sky-300" aria-label="Verificado" />}
    </span>
  );
}

