import{b6 as e}from"./index-q74-en5_.js";import{helperFunctions as o}from"./helperFunctions-B-VxibnW.js";import{i as t,h as c}from"./hdrFilteringFunctions-Bs6htGVI.js";import{p as d}from"./pbrBRDFFunctions-D5RPPlXL.js";const i="hdrIrradianceFilteringPixelShader",n=`#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
uniform samplerCube inputTexture;
#ifdef IBL_CDF_FILTERING
uniform sampler2D icdfTexture;
#endif
uniform vec2 vFilteringInfo;uniform float hdrScale;varying vec3 direction;void main() {vec3 color=irradiance(inputTexture,direction,vFilteringInfo,0.0,vec3(1.0),direction
#ifdef IBL_CDF_FILTERING
,icdfTexture
#endif
);gl_FragColor=vec4(color*hdrScale,1.0);}`;e.ShadersStore[i]||(e.ShadersStore[i]=n);const a=[o,t,d,c];for(const r of a)e.IncludesShadersStore[r.name]||(e.IncludesShadersStore[r.name]=r.shader);const m={name:i,shader:n};export{m as hdrIrradianceFilteringPixelShader};
