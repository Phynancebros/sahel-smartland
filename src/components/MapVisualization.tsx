import { useEffect, useRef, useState, useMemo } from 'react';
import { cn } from "@/lib/utils";
import { Layers, ZoomIn, ZoomOut, RotateCcw, Eye, Loader2, Info } from 'lucide-react';
import { 
  loadTIFF, 
  renderTIFFToCanvas, 
  renderVectorLayer,
  interpolateData, 
  landCoverColors, 
  landCoverClasses,
  getAvailableYears,
  calculateLandCoverStats,
  calculatePrecipitationStats,
  precipitationColorScale,
  vectorLayerColors
} from '@/lib/geospatialUtils';
import { useToast } from '@/components/ui/use-toast';
import LayersControl from './LayersControl';

interface MapVisualizationProps {
  className?: string;
  year?: number;
  onStatsChange?: (stats: Record<string, number>) => void;
  expandedView?: boolean;
  dataType?: 'landCover' | 'precipitation' | 'vegetation' | 'population';
}

const MapVisualization = ({ 
  className, 
  year = 2023, 
  onStatsChange,
  expandedView = false,
  dataType = 'landCover'
}: MapVisualizationProps) => {
  const { toast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeLayer, setActiveLayer] = useState(dataType);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>({
    landCover: true,
    precipitation: false,
    regionBoundaries: false,
    districtBoundaries: false,
    roadNetwork: false,
    riverNetwork: false
  });
  const [mapData, setMapData] = useState<{
    [dataType: string]: {
      [year: number]: { 
        data: number[], 
        width: number, 
        height: number,
        min?: number,
        max?: number
      }
    }
  }>({
    landCover: {},
    precipitation: {},
    vegetation: {},
    population: {},
    regionBoundaries: {},
    districtBoundaries: {},
    roadNetwork: {},
    riverNetwork: {}
  });
  const [currentStats, setCurrentStats] = useState<Record<string, number>>({});
  const [transitionAnimationId, setTransitionAnimationId] = useState<number | null>(null);
  const previousYearRef = useRef<number | null>(null);
  const previousDataTypeRef = useRef<string | null>(null);
  
  const { prevYear, nextYear, progress } = useMemo(() => {
    const availableYears = getAvailableYears(dataType);
    
    if (availableYears.includes(year)) {
      return { prevYear: year, nextYear: year, progress: 0 };
    }
    
    const prevYear = Math.max(...availableYears.filter(y => y <= year));
    const nextYear = Math.min(...availableYears.filter(y => y >= year));
    
    const yearRange = nextYear - prevYear;
    const progress = yearRange > 0 ? (year - prevYear) / yearRange : 0;
    
    return { prevYear, nextYear, progress };
  }, [year, dataType]);

  useEffect(() => {
    if (onStatsChange && Object.keys(currentStats).length > 0) {
      onStatsChange(currentStats);
    }
  }, [currentStats, onStatsChange]);

  useEffect(() => {
    setActiveLayer(dataType);
    previousDataTypeRef.current = dataType;
    
    setActiveLayers(prev => ({
      ...prev,
      landCover: dataType === 'landCover',
      precipitation: dataType === 'precipitation',
      vegetation: dataType === 'vegetation',
      population: dataType === 'population'
    }));
  }, [dataType]);

  useEffect(() => {
    const preloadMainDataLayers = async () => {
      setIsLoading(true);
      
      try {
        const availableYears = getAvailableYears(dataType);
        
        for (const yearToLoad of availableYears) {
          if (!mapData[dataType]?.[yearToLoad]) {
            const data = await loadTIFF(yearToLoad, dataType);
            setMapData(prev => ({
              ...prev,
              [dataType]: {
                ...(prev[dataType] || {}),
                [yearToLoad]: data
              }
            }));
          }
        }
      } catch (error) {
        console.error(`Error preloading ${dataType} data:`, error);
        toast({
          title: `Error loading ${dataType} data`,
          description: `Could not preload all the ${dataType} data years.`,
          variant: 'destructive'
        });
      } finally {
        setIsLoading(false);
      }
    };
    
    if (!mapData[dataType] || Object.keys(mapData[dataType]).length === 0) {
      preloadMainDataLayers();
    } else {
      setIsLoading(false);
    }
    
    return () => {
      if (transitionAnimationId !== null) {
        cancelAnimationFrame(transitionAnimationId);
      }
    };
  }, [dataType]);

  useEffect(() => {
    const loadVectorLayers = async () => {
      const vectorLayers = ['regionBoundaries', 'districtBoundaries', 'roadNetwork', 'riverNetwork'];
      
      for (const layerType of vectorLayers) {
        if (activeLayers[layerType] && !mapData[layerType]?.[0]) {
          try {
            setIsLoading(true);
            const data = await loadTIFF(0, layerType);
            
            setMapData(prev => ({
              ...prev,
              [layerType]: {
                0: data
              }
            }));
          } catch (error) {
            console.error(`Error loading ${layerType}:`, error);
            toast({
              title: `Error loading ${layerType}`,
              description: `Could not load the ${layerType} layer.`,
              variant: 'destructive'
            });
          } finally {
            setIsLoading(false);
          }
        }
      }
    };
    
    loadVectorLayers();
  }, [activeLayers]);

  useEffect(() => {
    const handleResize = () => {
      if (isLoading || !canvasRef.current || !containerRef.current) return;
      adjustCanvasSize();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isLoading]);

  const adjustCanvasSize = () => {
    if (!canvasRef.current || !containerRef.current) return;
    
    const canvas = canvasRef.current;
    const container = containerRef.current;
    const dataForType = mapData[dataType] || {};
    const prevYearData = dataForType[prevYear];
    
    if (!prevYearData) return;
    
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const dataAspectRatio = prevYearData.width / prevYearData.height;
    
    let displayWidth, displayHeight;
    
    if (containerWidth / containerHeight > dataAspectRatio) {
      displayHeight = containerHeight;
      displayWidth = displayHeight * dataAspectRatio;
    } else {
      displayWidth = containerWidth;
      displayHeight = displayWidth / dataAspectRatio;
    }
    
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    
    const scaleFactor = dataType === 'precipitation' ? 2 : 1;
    canvas.width = prevYearData.width * scaleFactor; 
    canvas.height = prevYearData.height * scaleFactor;
    
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(scaleFactor, scaleFactor);
      renderCurrentData();
    }
  };

  useEffect(() => {
    if (isLoading || !canvasRef.current || !containerRef.current) return;
    
    adjustCanvasSize();
    
    if (previousYearRef.current !== null && 
        (previousYearRef.current !== year || previousDataTypeRef.current !== dataType)) {
      if (transitionAnimationId !== null) {
        cancelAnimationFrame(transitionAnimationId);
      }
      
      const dataTypeChanged = previousDataTypeRef.current !== dataType;
      
      if (dataTypeChanged) {
        renderAllLayers();
      } else {
        animateYearTransition();
      }
    } else {
      renderAllLayers();
    }
    
    previousYearRef.current = year;
    previousDataTypeRef.current = dataType;
  }, [mapData, prevYear, nextYear, progress, isLoading, year, dataType, transitionAnimationId, activeLayers]);

  const renderAllLayers = () => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    
    if (activeLayers.landCover) {
      renderLayer('landCover', ctx);
    } else if (activeLayers.precipitation) {
      renderLayer('precipitation', ctx);
    }
    
    if (activeLayers.regionBoundaries) {
      renderVectorLayerOnCanvas('regionBoundaries', ctx);
    }
    
    if (activeLayers.districtBoundaries) {
      renderVectorLayerOnCanvas('districtBoundaries', ctx);
    }
    
    if (activeLayers.roadNetwork) {
      renderVectorLayerOnCanvas('roadNetwork', ctx);
    }
    
    if (activeLayers.riverNetwork) {
      renderVectorLayerOnCanvas('riverNetwork', ctx);
    }
  };

  const renderLayer = (layerType: string, ctx: CanvasRenderingContext2D) => {
    const dataForType = mapData[layerType] || {};
    const prevYearData = dataForType[prevYear];
    const nextYearData = dataForType[nextYear];
    
    if (!prevYearData || prevYearData.data.length === 0) {
      console.error(`No data for ${layerType} for year ${prevYear}`);
      return;
    }
    
    let renderData;
    let min = 0;
    let max = 500;
    
    if (nextYearData && prevYear !== nextYear) {
      renderData = interpolateData(
        prevYearData.data,
        nextYearData.data,
        progress
      );
      
      if (layerType === 'precipitation') {
        min = 0;
        max = 500;
      }
    } else {
      renderData = prevYearData.data;
    }
    
    renderTIFFToCanvas(
      ctx, 
      renderData, 
      prevYearData.width, 
      prevYearData.height,
      {
        opacity: 1,
        dataType: layerType,
        min,
        max,
        smoothing: layerType === 'precipitation'
      }
    );
    
    if (layerType === 'landCover') {
      const stats = calculateLandCoverStats(renderData);
      setCurrentStats(stats);
    } else if (layerType === 'precipitation') {
      const stats = calculatePrecipitationStats(renderData);
      setCurrentStats(stats);
    }
  };

  const renderVectorLayerOnCanvas = (layerType: string, ctx: CanvasRenderingContext2D) => {
    const layerData = mapData[layerType]?.[0];
    
    if (!layerData || layerData.data.length === 0) {
      console.error(`No data for vector layer ${layerType}`);
      return;
    }
    
    renderVectorLayer(
      ctx,
      layerData.data,
      layerData.width,
      layerData.height,
      layerType
    );
  };

  const animateYearTransition = () => {
    const dataForType = mapData[dataType] || {};
    const prevYearData = dataForType[prevYear];
    const nextYearData = dataForType[nextYear];
    
    if (!canvasRef.current || !prevYearData || !nextYearData) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    
    const previousYear = previousYearRef.current || year;
    const previousDataType = previousDataTypeRef.current || dataType;
    const previousData = mapData[previousDataType]?.[previousYear];
    
    if (!previousData) return;
    
    const startInterpolatedData = [...previousData.data];
    
    const endInterpolatedData = nextYearData && prevYear !== nextYear
      ? interpolateData(prevYearData.data, nextYearData.data, progress)
      : prevYearData.data;
    
    let animationProgress = 0;
    const animationDuration = 500;
    const startTime = performance.now();
    
    const animateTransition = (time: number) => {
      animationProgress = Math.min((time - startTime) / animationDuration, 1);
      
      const transitionData = startInterpolatedData.map((startValue, index) => {
        if (animationProgress >= 1) {
          return endInterpolatedData[index];
        }
        
        return Math.random() < animationProgress ? endInterpolatedData[index] : startValue;
      });
      
      let min = 0;
      let max = 500;
      
      renderTIFFToCanvas(
        ctx, 
        transitionData, 
        prevYearData.width, 
        prevYearData.height,
        {
          opacity: 1,
          dataType,
          min,
          max,
          smoothing: dataType === 'precipitation'
        }
      );
      
      if (animationProgress < 1) {
        const newAnimationId = requestAnimationFrame(animateTransition);
        setTransitionAnimationId(newAnimationId);
      } else {
        setTransitionAnimationId(null);
        if (dataType === 'landCover') {
          setCurrentStats(calculateLandCoverStats(endInterpolatedData));
        } else if (dataType === 'precipitation') {
          setCurrentStats(calculatePrecipitationStats(endInterpolatedData));
        }
      }
    };
    
    const animationId = requestAnimationFrame(animateTransition);
    setTransitionAnimationId(animationId);
  };

  const handleZoomIn = () => {
    setZoomLevel(prev => Math.min(prev + 0.2, 3));
  };

  const handleZoomOut = () => {
    setZoomLevel(prev => Math.max(prev - 0.2, 0.5));
  };

  const handleResetView = () => {
    setZoomLevel(1);
  };

  const handleLayerToggle = (layerId: string) => {
    if (layerId === 'landCover' || layerId === 'precipitation') {
      setActiveLayers(prev => ({
        ...prev,
        landCover: layerId === 'landCover',
        precipitation: layerId === 'precipitation'
      }));
    } else {
      setActiveLayers(prev => ({
        ...prev,
        [layerId]: !prev[layerId]
      }));
    }
  };

  const mapLayers = [
    { id: 'landCover' as const, name: 'Land Cover', color: 'bg-sahel-green' },
    { id: 'precipitation' as const, name: 'Rainfall', color: 'bg-sahel-blue' },
  ];

  const getCurrentLayerName = () => {
    const currentLayer = mapLayers.find(layer => layer.id === activeLayer);
    return currentLayer ? currentLayer.name : 'Layer';
  };

  const renderLegend = () => {
    if (activeLayers.landCover) {
      return (
        <div className="absolute bottom-3 left-3 bg-white/90 rounded-lg p-2 max-w-xs max-h-36 overflow-auto text-xs shadow-md">
          <div className="grid grid-cols-2 gap-1">
            {Object.entries(landCoverClasses)
              .filter(([key]) => key !== '0')
              .map(([key, name]) => (
                <div key={key} className="flex items-center">
                  <div 
                    className="w-3 h-3 rounded-sm mr-1"
                    style={{ backgroundColor: landCoverColors[Number(key) as keyof typeof landCoverColors] }}
                  />
                  <span className="truncate">{name}</span>
                </div>
              ))}
          </div>
        </div>
      );
    } else if (activeLayers.precipitation) {
      return (
        <div className="absolute bottom-3 left-3 bg-white/90 rounded-lg p-2 shadow-md">
          <div className="flex flex-col">
            <span className="text-xs font-medium mb-1">Precipitation (mm)</span>
            <div className="flex h-4 w-full">
              {precipitationColorScale.map((color, i) => (
                <div 
                  key={i} 
                  className="h-full flex-1" 
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs mt-1">
              <span>0 mm</span>
              <span>500 mm</span>
            </div>
          </div>
        </div>
      );
    } else {
      const vectorLayersActive = Object.entries(activeLayers)
        .filter(([key, isActive]) => isActive && ['regionBoundaries', 'districtBoundaries', 'roadNetwork', 'riverNetwork'].includes(key));
      
      if (vectorLayersActive.length > 0) {
        return (
          <div className="absolute bottom-3 left-3 bg-white/90 rounded-lg p-2 shadow-md">
            <div className="flex flex-col">
              <span className="text-xs font-medium mb-1">Map Features</span>
              <div className="space-y-1">
                {vectorLayersActive.map(([key]) => (
                  <div key={key} className="flex items-center">
                    <div 
                      className="w-3 h-3 mr-1"
                      style={{ backgroundColor: vectorLayerColors[key as keyof typeof vectorLayerColors] }}
                    />
                    <span className="text-xs">
                      {key === 'regionBoundaries' ? 'Region Boundaries' : 
                       key === 'districtBoundaries' ? 'District Boundaries' :
                       key === 'roadNetwork' ? 'Road Network' : 'River Network'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      }
    }
    
    return null;
  };

  return (
    <div className={cn(
      "relative rounded-xl overflow-hidden w-full h-full flex items-center justify-center", 
      className
    )} ref={containerRef}>
      <div className="absolute top-3 left-1/2 transform -translate-x-1/2 z-10 bg-white/80 dark:bg-muted/80 backdrop-blur-sm rounded-full px-3 py-1 text-xs font-medium flex items-center gap-1.5 shadow-sm">
        {year}
      </div>
      
      <div className="absolute inset-0 bg-sahel-sandLight overflow-hidden">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center">
              <Loader2 className="w-8 h-8 text-sahel-green animate-spin mb-3" />
              <p className="text-sm text-sahel-earth">Loading map data...</p>
            </div>
          </div>
        ) : (
          <div 
            className="absolute inset-0 flex items-center justify-center transition-transform duration-300 ease-out" 
            style={{ transform: `scale(${zoomLevel})` }}
          >
            <canvas 
              ref={canvasRef} 
              className="max-w-full max-h-full object-contain"
            />
          </div>
        )}
      </div>
      
      <div className="absolute top-3 right-3 flex flex-col gap-1.5">
        <button 
          onClick={handleZoomIn} 
          className="w-7 h-7 bg-white rounded-lg shadow-md flex items-center justify-center text-sahel-earth hover:bg-sahel-green hover:text-white transition-colors"
          aria-label="Zoom in"
        >
          <ZoomIn size={14} />
        </button>
        <button 
          onClick={handleZoomOut} 
          className="w-7 h-7 bg-white rounded-lg shadow-md flex items-center justify-center text-sahel-earth hover:bg-sahel-green hover:text-white transition-colors"
          aria-label="Zoom out"
        >
          <ZoomOut size={14} />
        </button>
        <button 
          onClick={handleResetView} 
          className="w-7 h-7 bg-white rounded-lg shadow-md flex items-center justify-center text-sahel-earth hover:bg-sahel-green hover:text-white transition-colors"
          aria-label="Reset view"
        >
          <RotateCcw size={14} />
        </button>
      </div>
      
      <LayersControl 
        activeLayers={activeLayers} 
        onLayerToggle={handleLayerToggle} 
      />
      
      <div className="absolute top-3 left-3">
        <div className="bg-white rounded-lg shadow-md p-1.5">
          <div className="flex items-center gap-1 px-1.5">
            <Layers size={12} className="text-sahel-earth" />
            <span className="text-xs font-medium">{getCurrentLayerName()}</span>
          </div>
        </div>
      </div>
      
      {renderLegend()}
    </div>
  );
};

export default MapVisualization;
