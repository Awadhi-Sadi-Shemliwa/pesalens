/* <MotionHeading fx="..."> — maps the registry TextFx enum to the wrapped
   ReactBits text components, theme-colored and reduced-motion aware.
   Text-only fx (split/blur/shiny/gradient) take a plain string via `text`;
   scroll fx (scrollreveal/scrollfloat) animate their children string. */
import React from 'react';
import { useMotionEnv } from './MotionProvider';
import { tokenHex } from './tokens';
import SplitText from '../components/reactbits/SplitText';
import BlurText from '../components/reactbits/BlurText';
import ShinyText from '../components/reactbits/ShinyText';
import GradientText from '../components/reactbits/GradientText';
import ScrollReveal from '../components/reactbits/ScrollReveal';
import ScrollFloat from '../components/reactbits/ScrollFloat';

const MotionHeading = ({ fx = 'none', text, children, className = '', tag = 'span', ...rest }) => {
  const { lite, reduced } = useMotionEnv();
  const content = text ?? (typeof children === 'string' ? children : undefined);

  if (reduced || fx === 'none') {
    if (fx === 'gradient') return <span className={`gradient-text ${className}`}>{content ?? children}</span>;
    return <span className={className}>{content ?? children}</span>;
  }

  switch (fx) {
    case 'split':
      return (
        <SplitText
          text={content}
          className={className}
          tag={tag}
          splitType={lite ? 'words' : 'chars'}
          delay={lite ? 60 : 26}
          duration={0.9}
          ease="power3.out"
          from={{ opacity: 0, y: 34 }}
          to={{ opacity: 1, y: 0 }}
          textAlign="left"
          threshold={0.15}
          rootMargin="-40px"
          {...rest}
        />
      );
    case 'blur':
      return (
        <BlurText
          text={content}
          className={className}
          animateBy="words"
          direction="top"
          delay={lite ? 90 : 60}
          stepDuration={0.3}
          {...rest}
        />
      );
    case 'shiny':
      return (
        <ShinyText
          text={content}
          className={className}
          speed={3.2}
          delay={1.2}
          color="currentColor"
          shineColor={tokenHex('--c-accent-h')}
          disabled={lite}
          {...rest}
        />
      );
    case 'gradient':
      return (
        <GradientText
          className={className}
          colors={[tokenHex('--c-accent'), tokenHex('--c-net'), tokenHex('--c-accent')]}
          animationSpeed={6}
          {...rest}
        >
          {content ?? children}
        </GradientText>
      );
    case 'scrollreveal':
      return (
        <ScrollReveal
          containerClassName={className}
          textClassName=""
          baseOpacity={0.12}
          baseRotation={2}
          blurStrength={lite ? 0 : 3}
          enableBlur={!lite}
          {...rest}
        >
          {content ?? children}
        </ScrollReveal>
      );
    case 'scrollfloat':
      return (
        <ScrollFloat
          containerClassName={className}
          textClassName=""
          animationDuration={1}
          stagger={0.028}
          {...rest}
        >
          {content ?? children}
        </ScrollFloat>
      );
    default:
      return <span className={className}>{content ?? children}</span>;
  }
};

export default MotionHeading;
