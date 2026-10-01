import React, { useState } from 'react';
import { 
  LineChart, Line, AreaChart, Area, 
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend, Sector
} from 'recharts';

const COLORS = [
  '#8b5cf6', // Violet (Candidates)
  '#64748b', // Slate (Pending)
  '#eab308', // Yellow (In Progress)
  '#10b981', // Emerald (Completed)
  '#ef4444', // Red (Flagged)
  '#22c55e', // Green (Selected)
  '#f43f5e', // Rose (Rejected)
];

export function InterviewTrendChart({ data }: { data: any[] }) {
  return (
    <div className="h-full min-h-[150px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#9b87f5" stopOpacity={0.3}/>
              <stop offset="95%" stopColor="#9b87f5" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
          <XAxis dataKey="date" stroke="#64748B" fontSize={10} tickFormatter={(str) => str.split('-').slice(1).join('/')} />
          <YAxis stroke="#64748B" fontSize={10} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
            itemStyle={{ color: '#0F172A' }}
          />
          <Area type="monotone" dataKey="count" stroke="#9b87f5" fillOpacity={1} fill="url(#colorCount)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RecruiterPerformanceChart({ data }: { data: any[] }) {
  return (
    <div className="h-full min-h-[150px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E2E8F0" />
          <XAxis type="number" stroke="#64748B" fontSize={10} />
          <YAxis dataKey="name" type="category" stroke="#64748B" fontSize={10} width={80} />
          <Tooltip 
            contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E2E8F0', borderRadius: 'var(--radius)', boxShadow: '0 4px 12px rgba(0,0,0,0.06)' }}
            itemStyle={{ color: '#0F172A' }}
          />
          <Legend />
          <Bar dataKey="interviews" fill="#9b87f5" radius={[0, 4, 4, 0]} name="Total Interviews" />
          <Bar dataKey="selections" fill="#10b981" radius={[0, 4, 4, 0]} name="Selections" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const renderActiveShape = (props: any) => {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill, payload, percent, value } = props;
  
  return (
    <g>
      <text x={cx} y={cy - 5} dy={0} textAnchor="middle" fill={fill} fontSize={11} fontWeight="bold">
        {payload.stage}
      </text>
      <text x={cx} y={cy + 10} dy={0} textAnchor="middle" fill="#888" fontSize={10}>
        {value} ({`${(percent * 100).toFixed(0)}%`})
      </text>
      <Sector
        cx={cx}
        cy={cy}
        innerRadius={innerRadius}
        outerRadius={outerRadius + 6}
        startAngle={startAngle}
        endAngle={endAngle}
        fill={fill}
      />
      <Sector
        cx={cx}
        cy={cy}
        startAngle={startAngle}
        endAngle={endAngle}
        innerRadius={outerRadius + 8}
        outerRadius={outerRadius + 10}
        fill={fill}
      />
    </g>
  );
};

export function PipelineChart({ data, onStageClick }: { data: any[]; onStageClick?: (filterId: string) => void }) {
  const [activeIndex, setActiveIndex] = useState(0);

  const onPieEnter = (_: any, index: number) => {
    setActiveIndex(index);
  };

  if (!data || data.length === 0) return null;

  return (
    <div className="h-full min-h-[150px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            activeIndex={activeIndex}
            activeShape={renderActiveShape}
            data={data}
            cx="40%"
            cy="50%"
            innerRadius={45}
            outerRadius={60}
            paddingAngle={5}
            dataKey="count"
            nameKey="stage"
            onMouseEnter={onPieEnter}
            onClick={(entry: any) => {
              if (onStageClick && entry?.filterId) {
                onStageClick(entry.filterId);
              }
            }}
          >
            {data.map((entry, index) => (
              <Cell 
                key={`cell-${index}`} 
                fill={COLORS[index % COLORS.length]} 
                style={{ outline: 'none', cursor: onStageClick ? 'pointer' : 'default' }} 
              />
            ))}
          </Pie>
          <Legend 
            layout="vertical" 
            verticalAlign="middle" 
            align="right"
            iconSize={8}
            wrapperStyle={{ fontSize: '10px', right: 0, cursor: onStageClick ? 'pointer' : 'default' }}
            onClick={(props: any) => {
              if (onStageClick && props?.payload?.filterId) {
                onStageClick(props.payload.filterId);
              }
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
