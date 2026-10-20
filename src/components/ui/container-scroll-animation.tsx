import React, { useEffect, useRef, useState } from "react";
import { MotionValue, motion, useScroll, useTransform, useSpring } from "framer-motion";

export function ContainerScroll({
  titleComponent,
  children,
}: {
  titleComponent: string | React.ReactNode;
  children: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start end", "end start"],
  });
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => {
      window.removeEventListener("resize", checkMobile);
    };
  }, []);

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001
  });

  const rotate = useTransform(smoothProgress, [0, 0.4], [20, 0]);
  const scale = useTransform(smoothProgress, [0, 0.4], isMobile ? [0.8, 0.95] : [1.05, 1]);
  const translate = useTransform(smoothProgress, [0, 0.4], [0, -40]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-[32rem] items-center justify-center p-1 md:h-[50rem] md:p-8"
    >
      <div
        className="relative w-full py-0 md:py-4"
        style={{
          perspective: "1000px",
        }}
      >
        <Header translate={translate} titleComponent={titleComponent} />
        <Card rotate={rotate} scale={scale}>
          {children}
        </Card>
      </div>
    </div>
  );
}

function Header({
  translate,
  titleComponent,
}: {
  translate: MotionValue<number>;
  titleComponent: string | React.ReactNode;
}) {
  return (
    <motion.div
      style={{
        translateY: translate,
      }}
      className="mx-auto max-w-5xl text-center"
    >
      {titleComponent}
    </motion.div>
  );
}

function Card({
  rotate,
  scale,
  children,
}: {
  rotate: MotionValue<number>;
  scale: MotionValue<number>;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      style={{
        rotateX: rotate,
        scale,
        boxShadow:
          "0 0 #0000004d, 0 9px 20px #0000004a, 0 37px 37px #00000042, 0 84px 50px #00000026, 0 149px 60px #0000000a, 0 233px 65px #00000003",
      }}
      className="mx-auto -mt-10 h-[22rem] w-full max-w-5xl rounded-[30px] border-4 border-[#6C6C6C] bg-[#222222] p-2 shadow-2xl md:-mt-12 md:h-[35rem] md:p-6"
    >
      <div className="h-full w-full overflow-hidden rounded-2xl bg-slate-100 md:p-4">
        {children}
      </div>
    </motion.div>
  );
}
