/* <MotionCard fx="..."> — registry CardFx enum → card treatment.
   spotlight = pointer-tracked radial highlight (ReactBits SpotlightCard)
   tilt      = existing PesaLens TiltCard (pointer 3D tilt + optional glare)
   glare     = sweep-on-hover (ReactBits GlareHover)
   star      = animated star border (CTAs)
   Touch / reduced-motion render a plain elevated card. */
import React from 'react';
import { useMotionEnv } from './MotionProvider';
import { tokenChannels, tokenHex } from './tokens';
import { TiltCard } from '../components/motion';
import SpotlightCard from '../components/reactbits/SpotlightCard';
import GlareHover from '../components/reactbits/GlareHover';
import StarBorder from '../components/reactbits/StarBorder';

const MotionCard = ({ fx = 'none', children, className = '', glow = 'accent', ...rest }) => {
  const { lite, reduced, isTouch } = useMotionEnv();
  const still = reduced || isTouch;
  const glowVar = glow === 'net' ? '--c-net' : '--c-accent';

  if (fx === 'star') {
    return (
      <StarBorder
        as="div"
        className={className}
        color={tokenHex(glowVar)}
        speed="5s"
        thickness={1}
        innerClassName="bg-surface-2 border border-bdr"
        {...rest}
      >
        {children}
      </StarBorder>
    );
  }

  if (still || fx === 'none') {
    return (
      <div className={`card-soft ${className}`} {...rest}>
        {children}
      </div>
    );
  }

  switch (fx) {
    case 'spotlight':
      return (
        <SpotlightCard
          className={`card-soft ${className}`}
          spotlightColor={`rgba(${tokenChannels(glowVar)}, 0.14)`}
          {...rest}
        >
          {children}
        </SpotlightCard>
      );
    case 'tilt':
      return (
        <TiltCard className={`card-soft ${className}`} max={lite ? 4 : 7} glare {...rest}>
          {children}
        </TiltCard>
      );
    case 'glare':
      return (
        <GlareHover
          width="auto"
          height="auto"
          background="transparent"
          borderRadius="16px"
          borderColor="transparent"
          glareColor={tokenHex(glowVar)}
          glareOpacity={0.18}
          glareSize={220}
          className={`card-soft ${className}`}
          {...rest}
        >
          {children}
        </GlareHover>
      );
    default:
      return (
        <div className={`card-soft ${className}`} {...rest}>
          {children}
        </div>
      );
  }
};

export default MotionCard;
