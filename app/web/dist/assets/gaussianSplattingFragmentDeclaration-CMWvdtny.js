import{b6 as r}from"./index-Crtbj3yS.js";import"./logDepthFragment-iyjhaP3u.js";import"./fogFragment-C6d7PkFo.js";import"./objectIdFunctions-Bzs_g-nn.js";const o="gaussianSplattingFragmentDeclaration",e=`vec4 gaussianColor(vec4 inColor)
{float A=-dot(vPosition,vPosition);if (A<-4.0) discard;float B=exp(A)*inColor.a;
#include<logDepthFragment>
vec3 color=inColor.rgb;
#ifdef FOG
#include<fogFragment>
#endif
return vec4(color,B);}
`;r.IncludesShadersStore[o]||(r.IncludesShadersStore[o]=e);const s={name:o,shader:e};export{s as gaussianSplattingFragmentDeclaration};
