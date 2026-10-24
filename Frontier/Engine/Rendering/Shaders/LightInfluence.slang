/*==========================================================================================================================================
                                                        LIGHTINFLUENCE.SLANG
==========================================================================================================================================*/
// 🧩 Conservative analytic light cells, exact or fresh-RIS illumination, and triangle-enclosure visibility.

struct LightShape
{
    float4 PositionReach, RadianceCategory, DirectionInner, UpOuter;
    uint4 Profile;
    float4 PeakActive;
};
struct SurfacePoint
{
    float4 PositionHit, NormalRoughness, ViewMetallic, AlbedoIor, ResidualSpecular, ExpectedDirect;
};
struct FacetEnclosure { float4 Minimum,Maximum; uint4 Links; };
struct FacetCorners { float4 A,B,C; };
struct ComputeExtent
{
    uint4 Dimensions; // receiver count, light count, cell capacity, evaluation: 0 all, 1 cell, 2 fresh RIS
    float4 Minimum, Maximum;
    uint4 Grid; // xyz resolution, enclosure count
    uint4 Sampling; // seed, RIS candidate count, facet count, enclosure-stack capacity
};
[[vk::binding(0,0)]] StructuredBuffer<LightShape> Lights;
[[vk::binding(1,0)]] StructuredBuffer<SurfacePoint> Receivers;
[[vk::binding(2,0)]] StructuredBuffer<FacetEnclosure> Enclosures;
[[vk::binding(3,0)]] StructuredBuffer<FacetCorners> Facets;
[[vk::binding(4,0)]] StructuredBuffer<float> Angles;
[[vk::binding(5,0)]] RWStructuredBuffer<uint> Cells;
[[vk::binding(6,0)]] RWStructuredBuffer<float4> OutputColour;
[[vk::binding(7,0)]] RWStructuredBuffer<uint> Counters;
[[vk::push_constant]] ConstantBuffer<ComputeExtent> Extent;

float3 Unit(float3 P) { float Squared=dot(P,P);return Squared>0?P*rsqrt(Squared):float3(0,0,1); }
float Power(float3 C) { return dot(C,float3(.2126,.7152,.0722)); }

[shader("compute")]
[numthreads(64,1,1)]
void AssignLightCells(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Count=Extent.Grid.x*Extent.Grid.y*Extent.Grid.z;
    if(Dispatch.x>=Count)return;
    uint3 Cell=uint3(Dispatch.x%Extent.Grid.x,(Dispatch.x/Extent.Grid.x)%Extent.Grid.y,Dispatch.x/(Extent.Grid.x*Extent.Grid.y));
    float3 Step=(Extent.Maximum.xyz-Extent.Minimum.xyz)/float3(Extent.Grid.xyz);
    float3 Low=Extent.Minimum.xyz+float3(Cell)*Step, High=Low+Step;
    uint First=Dispatch.x*(Extent.Dimensions.z+1), Retained=0;
    for(uint Index=0;Index<Extent.Dimensions.y;++Index)
    {
        LightShape L=Lights[Index];float3 Delta=L.PositionReach.xyz-clamp(L.PositionReach.xyz,Low,High);
        float Squared=dot(Delta,Delta), RadiusSquared=L.PositionReach.w*L.PositionReach.w;
        if(L.RadianceCategory.w==0 || L.PositionReach.w==0 || Squared<=RadiusSquared+64*1.1920929e-7*max(1,max(Squared,RadiusSquared)))
        {
            if(Retained<Extent.Dimensions.z)Cells[First+1+Retained]=Index;
            ++Retained;
        }
    }
    Cells[First]=Retained; // Above capacity means exhaustive fallback, never truncated illumination.
}

bool IntersectsBox(FacetEnclosure Box,float3 Origin,float3 Direction,float Far)
{
    float Near=0;
    for(uint Axis=0;Axis<3;++Axis)
    {
        if(abs(Direction[Axis])<1e-30)
        { if(Origin[Axis]<Box.Minimum[Axis] || Origin[Axis]>Box.Maximum[Axis])return false; }
        else
        {
            float A=(Box.Minimum[Axis]-Origin[Axis])/Direction[Axis], B=(Box.Maximum[Axis]-Origin[Axis])/Direction[Axis];
            Near=max(Near,min(A,B));Far=min(Far,max(A,B));if(Far<Near)return false;
        }
    }
    return Far>=Near;
}
bool IntersectsFacet(FacetCorners Triangle,float3 Origin,float3 Direction,float Far)
{
    float3 EdgeA=Triangle.B.xyz-Triangle.A.xyz,EdgeB=Triangle.C.xyz-Triangle.A.xyz;
    float3 P=cross(Direction,EdgeB);float Determinant=dot(EdgeA,P);
    if(abs(Determinant)<1e-12)return false;
    float3 Offset=Origin-Triangle.A.xyz;float U=dot(Offset,P)/Determinant;
    if(U<0||U>1)return false;
    float3 Q=cross(Offset,EdgeA);float V=dot(Direction,Q)/Determinant;
    if(V<0 || U+V>1)return false;
    float Distance=dot(EdgeB,Q)/Determinant;
    return Distance>=0 && Distance<=Far;
}
bool Occluded(float3 Origin,float3 Direction,float Far)
{
    if(Extent.Grid.w==0 || Far<0)return false;
    InterlockedAdd(Counters[2],1);
    uint Stack[64];uint Count=1;Stack[0]=0;
    while(Count>0)
    {
        FacetEnclosure Box=Enclosures[Stack[--Count]];
        if(!IntersectsBox(Box,Origin,Direction,Far))continue;
        if(Box.Links.z!=0)
        {
            for(uint I=0;I<Box.Links.y;++I)
                if(IntersectsFacet(Facets[Box.Links.x+I],Origin,Direction,Far))return true;
        }
        else
        {
            if(Count+2>min(64u,max(1u,Extent.Sampling.w)))
            {
                InterlockedAdd(Counters[3],1);
                for(uint I=0;I<Extent.Sampling.z;++I)
                    if(IntersectsFacet(Facets[I],Origin,Direction,Far))return true;
                return false;
            }
            Stack[Count++]=Box.Links.x;Stack[Count++]=Box.Links.y;
        }
    }
    return false;
}
float2 Interval(uint Offset,uint Count,float Angle)
{
    if(Count==1)return float2(0,0);
    uint Low=0;
    for(uint I=1;I<Count;++I){if(Angles[Offset+I]>Angle)break;Low=I;}
    Low=min(Low,Count-2);
    return float2(Low,saturate((Angle-Angles[Offset+Low])/(Angles[Offset+Low+1]-Angles[Offset+Low])));
}
float ProfileIntensity(LightShape L,float θ,float φ)
{
    if(L.Profile.y==0)return 1;
    if(θ<Angles[L.Profile.x] || θ>Angles[L.Profile.x+L.Profile.y-1])return 0;
    φ=fmod(φ+360,360);
    float Coverage=Angles[L.Profile.z+L.Profile.w-1];
    if(L.Profile.w>1)
    {
        if(Coverage==90){if(φ>180)φ=360-φ;if(φ>90)φ=180-φ;}
        else if(Coverage==180 && φ>180)φ=360-φ;
    }
    float2 V=Interval(L.Profile.x,L.Profile.y,θ),H=Interval(L.Profile.z,L.Profile.w,φ);
    uint A=uint(L.PeakActive.z)+uint(H.x)*L.Profile.y+uint(V.x);
    uint B=uint(L.PeakActive.z)+min(uint(H.x)+1,L.Profile.w-1)*L.Profile.y+uint(V.x);
    return lerp(lerp(Angles[A],Angles[A+1],V.y),lerp(Angles[B],Angles[B+1],V.y),H.y)/L.PeakActive.x;
}
float3 Arrival(LightShape L,float3 Point,out float3 Direction,out float Distance)
{
    Direction=L.PositionReach.xyz;Distance=1e30;
    if(L.PeakActive.y==0)return 0;
    if(L.RadianceCategory.w==0)return L.RadianceCategory.xyz;
    float3 Delta=L.PositionReach.xyz-Point;Distance=length(Delta);Direction=Distance>0?Delta/Distance:float3(0,0,1);
    if(L.PositionReach.w>0 && Distance>=L.PositionReach.w)return 0;
    float Angular=1;
    if(L.RadianceCategory.w==2 || L.Profile.y!=0)
    {
        float3 Forward=Unit(L.DirectionInner.xyz),Toward=-Direction;
        float Cosine=clamp(dot(Forward,Toward),-1,1);
        if(L.RadianceCategory.w==2)
        {float T=saturate((Cosine-L.UpOuter.w)/(L.DirectionInner.w-L.UpOuter.w));Angular=T*T*(3-2*T);}
        if(L.Profile.y!=0)
        {
            float3 Right=Unit(cross(L.UpOuter.xyz,Forward)),Up=cross(Forward,Right);
            Angular*=ProfileIntensity(L,acos(Cosine)*180/3.141592653589793,atan2(dot(Toward,Right),dot(Toward,Up))*180/3.141592653589793);
        }
    }
    float Window=1;
    if(L.PositionReach.w>0){float Q=Distance/L.PositionReach.w;Window=1-Q*Q*Q*Q;Window*=Window;}
    return L.RadianceCategory.xyz*(Angular*Window/max(Distance*Distance,1e-6));
}
float3 Brdf(SurfacePoint R,float3 Direction)
{
    float3 N=Unit(R.NormalRoughness.xyz),V=Unit(R.ViewMetallic.xyz),L=Unit(Direction);
    float NV=max(dot(N,V),0),NL=max(dot(N,L),0);if(NV<=0 || NL<=0)return 0;
    float3 H=Unit(V+L);float NH=saturate(dot(N,H)),VH=saturate(dot(V,H));
    float Roughness=clamp(R.NormalRoughness.w,.04,1),α=Roughness*Roughness,α2=α*α;
    float Denominator=NH*NH*(α2-1)+1;
    float Distribution=α2/(3.141592653589793*Denominator*Denominator);
    float Visibility=.5/max(NL*sqrt(NV*NV*(1-α2)+α2)+NV*sqrt(NL*NL*(1-α2)+α2),1e-12);
    float Ior=max(R.AlbedoIor.w,1),Ratio=(Ior-1)/(Ior+1),Metallic=saturate(R.ViewMetallic.w);
    float Dielectric=Ratio*Ratio*saturate(R.ResidualSpecular.w)*2;
    float3 F0=lerp(float3(Dielectric),R.AlbedoIor.xyz,Metallic);
    float3 Fresnel=F0+(1-F0)*pow(1-VH,5);
    return Distribution*Visibility*Fresnel+(1-Fresnel)*R.AlbedoIor.xyz*((1-Metallic)/3.141592653589793);
}
float3 Contribution(SurfacePoint R,uint Index,out float3 Direction,out float Distance)
{
    float3 Incoming=Arrival(Lights[Index],R.PositionHit.xyz,Direction,Distance);
    if(all(Incoming==0))return 0;
    return Brdf(R,Direction)*Incoming*max(dot(R.NormalRoughness.xyz,Direction),0);
}
uint NextRandom(inout uint Bits){Bits=1664525*Bits+1013904223;return Bits;}
float RandomUnit(inout uint Bits){return float(NextRandom(Bits)>>8)*(1.0/16777216.0);}

[shader("compute")]
[numthreads(64,1,1)]
void EvaluateLightReceivers(uint3 Dispatch : SV_DispatchThreadID)
{
    uint Pixel=Dispatch.x;if(Pixel>=Extent.Dimensions.x)return;
    SurfacePoint R=Receivers[Pixel];
    if(R.PositionHit.w==0){OutputColour[Pixel]=float4(R.ResidualSpecular.xyz,0);return;}
    uint First=0,Count=Extent.Dimensions.y;bool Whole=Extent.Dimensions.w==0;
    if(!Whole)
    {
        float3 Point=R.PositionHit.xyz;
        if(any(Point<Extent.Minimum.xyz)||any(Point>=Extent.Maximum.xyz))Whole=true;
        else
        {
            uint3 Cell=min(uint3((Point-Extent.Minimum.xyz)/(Extent.Maximum.xyz-Extent.Minimum.xyz)*float3(Extent.Grid.xyz)),Extent.Grid.xyz-1);
            First=((Cell.z*Extent.Grid.y+Cell.y)*Extent.Grid.x+Cell.x)*(Extent.Dimensions.z+1);
            Count=Cells[First];if(Count>Extent.Dimensions.z)Whole=true;
        }
        if(Whole){Count=Extent.Dimensions.y;InterlockedAdd(Counters[1],1);}
    }
    InterlockedAdd(Counters[0],Count);
    float3 Direct=0;
    if(Extent.Dimensions.w==2)
    {
        float Mass=0;
        for(uint I=0;I<Count;++I){uint Index=Whole?I:Cells[First+1+I];Mass+=max(Power(Lights[Index].RadianceCategory.xyz),1e-6);}
        uint Bits=Extent.Sampling.x^(Pixel*747796405u+2891336453u),Selected=0;float WeightSum=0,SelectedTarget=0;
        for(uint C=0;C<Extent.Sampling.y && Count>0;++C)
        {
            float Draw=RandomUnit(Bits)*Mass,Sum=0;uint Index=Whole?Count-1:Cells[First+Count];
            for(uint I=0;I<Count;++I){uint Candidate=Whole?I:Cells[First+1+I];Sum+=max(Power(Lights[Candidate].RadianceCategory.xyz),1e-6);if(Draw<Sum){Index=Candidate;break;}}
            float3 Dir;float Dist;float Target=Power(Contribution(R,Index,Dir,Dist));
            float Proposal=max(Power(Lights[Index].RadianceCategory.xyz),1e-6)/Mass,Weight=Target/Proposal;
            WeightSum+=Weight;if(RandomUnit(Bits)*WeightSum<Weight){Selected=Index;SelectedTarget=Target;}
        }
        if(SelectedTarget>0)
        {
            float3 Dir;float Dist;float3 F=Contribution(R,Selected,Dir,Dist);
            if(!Occluded(R.PositionHit.xyz+R.NormalRoughness.xyz*.002,Dir,Dist-.004))Direct=F*(WeightSum/(Extent.Sampling.y*SelectedTarget));
        }
    }
    else
    {
        for(uint I=0;I<Count;++I)
        {
            uint Index=Whole?I:Cells[First+1+I];float3 Dir;float Dist;float3 F=Contribution(R,Index,Dir,Dist);
            if(any(F!=0) && !Occluded(R.PositionHit.xyz+R.NormalRoughness.xyz*.002,Dir,Dist-.004))Direct+=F;
        }
    }
    OutputColour[Pixel]=float4(Direct+R.ResidualSpecular.xyz,Power(Direct));
}
