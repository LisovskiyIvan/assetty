import{b6 as i}from"./index-Z4a9ijJv.js";import{helperFunctions as o}from"./helperFunctions-CW3O_QGS.js";import{i as t,h as c}from"./hdrFilteringFunctions-YvOQxtD8.js";import{p as a}from"./pbrBRDFFunctions-C37yqbak.js";const r="iblDominantDirectionPixelShader",n=`precision highp sampler2D;precision highp samplerCube;
#include<helperFunctions>
#include<importanceSampling>
#include<pbrBRDFFunctions>
#include<hdrFilteringFunctions>
varying vec2 vUV;uniform sampler2D icdfSampler;void main(void) {vec3 lightDir=vec3(0.0,0.0,0.0);for(uint i=0u; i<NUM_SAMPLES; ++i)
{vec2 Xi=hammersley(i,NUM_SAMPLES);vec2 T;T.x=texture2D(icdfSampler,vec2(Xi.x,0.0)).x;T.y=texture2D(icdfSampler,vec2(T.x,Xi.y)).y;vec3 Ls=uv_to_normal(vec2(1.0-fract(T.x+0.25),T.y));lightDir+=Ls;}
lightDir/=float(NUM_SAMPLES);gl_FragColor=vec4(lightDir,1.0);}`;i.ShadersStore[r]||(i.ShadersStore[r]=n);const l=[o,t,a,c];for(const e of l)i.IncludesShadersStore[e.name]||(i.IncludesShadersStore[e.name]=e.shader);const h={name:r,shader:n};export{h as iblDominantDirectionPixelShader};
