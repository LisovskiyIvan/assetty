import{b6 as r}from"./index-D8wS8RSU.js";import"./logDepthFragment-CV6DpO_x.js";import"./fogFragment-GxSsSQOr.js";import"./objectIdFunctions-CrPjBn97.js";const o="gaussianSplattingFragmentDeclaration",e=`vec4 gaussianColor(vec4 inColor)
{float A=-dot(vPosition,vPosition);if (A<-4.0) discard;float B=exp(A)*inColor.a;
#include<logDepthFragment>
vec3 color=inColor.rgb;
#ifdef FOG
#include<fogFragment>
#endif
return vec4(color,B);}
`;r.IncludesShadersStore[o]||(r.IncludesShadersStore[o]=e);const s={name:o,shader:e};export{s as gaussianSplattingFragmentDeclaration};
