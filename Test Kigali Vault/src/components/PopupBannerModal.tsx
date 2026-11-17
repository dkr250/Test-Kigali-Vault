import { ArrowRight, X } from 'lucide-react';
import type { PopupBannerConfig } from '../types.ts';
import { ProductImage } from './ProductImage.tsx';

interface PopupBannerCardProps {
  popup: PopupBannerConfig;
  onClose?: () => void;
  onAction?: () => void;
  compact?: boolean;
}

export function PopupBannerCard({
  popup,
  onClose,
  onAction,
  compact = false,
}: PopupBannerCardProps) {
  const alignClass =
    popup.text_align === 'center'
      ? 'text-center items-center'
      : popup.text_align === 'right'
        ? 'text-right items-end'
        : 'text-left items-start';

  const textColorClass =
    popup.text_color === 'navy'
      ? 'text-[#0B1F3A]'
      : popup.text_color === 'gold'
        ? 'text-[#F8F1E1]'
        : 'text-white';

  const descColorClass =
    popup.text_color === 'navy'
      ? 'text-slate-600'
      : popup.text_color === 'gold'
        ? 'text-[#F8F1E1]/90'
        : 'text-white/90';

  const surfaceClass = (() => {
    if (popup.overlay_style === 'light_card') {
      return 'bg-white/95 backdrop-blur-sm border border-slate-200 shadow-lg';
    }
    if (popup.overlay_style === 'navy_banner') {
      return 'bg-[#0B1F3A]/95 backdrop-blur-sm border border-[#C99E44]/40';
    }
    if (popup.overlay_style === 'transparent') {
      return 'bg-transparent';
    }
    // dark_scrim default
    if (popup.text_position === 'below_image') {
      return 'bg-[#061326]';
    }
    if (popup.text_position === 'top') {
      return 'bg-gradient-to-b from-[#061326]/90 via-[#061326]/60 to-transparent';
    }
    if (popup.text_position === 'center') {
      return 'bg-[#061326]/65 backdrop-blur-[1px]';
    }
    return 'bg-gradient-to-t from-[#061326]/90 via-[#061326]/60 to-transparent';
  })();

  const positionContainerClass =
    popup.text_position === 'top'
      ? 'inset-x-0 top-0'
      : popup.text_position === 'center'
        ? 'inset-0 flex flex-col justify-center'
        : 'inset-x-0 bottom-0';

  const isShadowText =
    popup.overlay_style === 'transparent' && popup.text_position !== 'below_image';

  const headlineEl = popup.headline ? (
    <h3
      className={`font-display font-bold tracking-tight ${textColorClass} ${
        compact ? 'text-base leading-snug' : 'text-xl sm:text-2xl leading-tight'
      } ${isShadowText ? 'drop-shadow-md' : ''}`}
    >
      {popup.headline}
    </h3>
  ) : null;

  const descriptionEl = popup.description ? (
    <p
      className={`${descColorClass} ${
        compact ? 'text-xs leading-relaxed line-clamp-3' : 'text-sm leading-relaxed max-w-lg'
      } ${isShadowText ? 'drop-shadow' : ''}`}
    >
      {popup.description}
    </p>
  ) : null;

  const hasText = Boolean(popup.headline || popup.description || popup.cta_label);

  const textBlock = hasText ? (
    <div
      className={`flex flex-col gap-2 ${alignClass} ${
        popup.overlay_style === 'light_card' || popup.overlay_style === 'navy_banner'
          ? popup.text_position === 'below_image'
            ? compact
              ? 'p-4'
              : 'p-6'
            : compact
              ? 'm-3 p-3.5 rounded-lg'
              : 'm-5 p-5 rounded-xl'
          : compact
            ? 'p-4'
            : 'p-6 sm:p-7'
      } ${surfaceClass}`}
    >
      {popup.text_order === 'description_first' ? (
        <>
          {descriptionEl}
          {headlineEl}
        </>
      ) : (
        <>
          {headlineEl}
          {descriptionEl}
        </>
      )}

      {popup.cta_label && (
        <div className="pt-1">
          <button
            type="button"
            onClick={onAction}
            className={`inline-flex items-center gap-1.5 font-semibold rounded-lg transition-colors cursor-pointer ${
              compact ? 'px-3 py-1.5 text-xs' : 'px-5 py-2.5 text-xs sm:text-sm'
            } ${
              popup.overlay_style === 'light_card' || popup.text_color === 'navy'
                ? 'bg-[#0B1F3A] text-white hover:bg-[#142E52]'
                : 'bg-[#C99E44] text-[#061326] hover:bg-[#D8AF58]'
            }`}
          >
            <span>{popup.cta_label}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="relative bg-white rounded-xl overflow-hidden border border-slate-200 shadow-2xl w-full">
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Close popup banner"
          className="absolute top-3 right-3 z-20 p-1.5 rounded-full bg-[#061326]/75 text-white hover:bg-[#061326] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className={`relative w-full bg-[#061326] ${compact ? 'aspect-[16/10]' : 'aspect-[16/10] sm:aspect-[16/9]'}`}>
        {popup.image_url ? (
          <ProductImage
            src={popup.image_url}
            alt={popup.headline || 'Marketplace promotional popup'}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
            Upload or choose a promotional image
          </div>
        )}

        {popup.text_position !== 'below_image' && textBlock && (
          <div className={`absolute ${positionContainerClass} z-10 pointer-events-auto`}>
            {textBlock}
          </div>
        )}
      </div>

      {popup.text_position === 'below_image' && textBlock}
    </div>
  );
}

export function PopupBannerModal({
  popup,
  onClose,
  onAction,
}: {
  popup: PopupBannerConfig;
  onClose: () => void;
  onAction: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-[#061326]/70 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="max-w-xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <PopupBannerCard popup={popup} onClose={onClose} onAction={onAction} />
      </div>
    </div>
  );
}
