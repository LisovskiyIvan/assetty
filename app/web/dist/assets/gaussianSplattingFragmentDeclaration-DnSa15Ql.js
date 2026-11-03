import{b6 as r}from"./index-CmAuwD34.js";import"./logDepthFragment-BSgC2ZRg.js";import"./fogFragment-BngX5ywf.js";import"./objectIdFunctions-BBa232XR.js";const o="gaussianSplattingFragmentDeclaration",e=`vec4 gaussianColor(vec4 inColor)
{float A=-dot(vPosition,vPosition);if (A<-4.0) discard;float B=exp(A)*inColor.a;
#include<logDepthFragment>
vec3 color=inColor.rgb;
#ifdef FOG
#include<fogFragment>
#endif
return vec4(color,B);}
`;r.IncludesShadersStore[o]||(r.IncludesShadersStore[o]=e);const s={name:o,shader:e};export{s as gaussianSplattingFragmentDeclaration};
