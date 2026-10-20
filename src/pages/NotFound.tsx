import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { ChefHat, ArrowLeft, Search, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-12 max-w-2xl"
        >
          <div className="relative mx-auto w-32 h-32">
             <motion.div 
               animate={{ 
                 rotate: [360, 0],
                 scale: [1, 1.1, 1]
               }}
               transition={{ 
                 duration: 20, 
                 repeat: Infinity, 
                 ease: "linear" 
               }}
               className="absolute inset-0 bg-primary/20 rounded-2xl blur-2xl"
             />
             <div className="relative h-full w-full flex items-center justify-center rounded-[2.5rem] bg-white border border-slate-100 shadow-2xl">
               <ChefHat className="h-16 w-16 text-primary" />
             </div>
          </div>

          <div className="space-y-6">
            <h1 className="text-7xl lg:text-7xl font-black tracking-tighter uppercase text-slate-950">
              Lost in <br /> <span className="text-primary italic">Transit</span>
            </h1>
            <p className="text-xl md:text-2xl text-slate-500 font-bold leading-relaxed">
              The endpoint <span className="text-slate-950 font-black">"{location.pathname}"</span> does not exist in the dashboard network. 
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 pt-4">
            <Button asChild size="lg" className="h-20 px-10 rounded-2xl bg-slate-950 text-white font-black hover:scale-105 transition-transform text-lg shadow-xl shadow-slate-950/20">
              <Link to="/" className="flex items-center">
                <ArrowLeft className="mr-3 h-6 w-6" />
                Return to Dashboard
              </Link>
            </Button>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default NotFound;
