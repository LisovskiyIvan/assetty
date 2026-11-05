import{b6 as e}from"./index-BNNeZAnZ.js";import{clipPlaneFragmentDeclaration as o}from"./clipPlaneFragmentDeclaration-B0Y6zee2.js";import{packingFunctions as n}from"./packingFunctions-CDqX4zok.js";import{clipPlaneFragment as d}from"./clipPlaneFragment-kdiuNdGF.js";const r="depthPixelShader",a=`#ifdef ALPHATEST
varying vec2 vUV;uniform sampler2D diffuseSampler;
#endif
#include<clipPlaneFragmentDeclaration>
varying float vDepthMetric;
#ifdef PACKED
#include<packingFunctions>
#endif
#ifdef STORE_CAMERASPACE_Z
varying vec4 vViewPos;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void)
{
#include<clipPlaneFragment>
#ifdef ALPHATEST
if (texture2D(diffuseSampler,vUV).a<0.4)
discard;
#endif
#ifdef STORE_CAMERASPACE_Z
#ifdef PACKED
gl_FragColor=pack(vViewPos.z);
#else
gl_FragColor=vec4(vViewPos.z,0.0,0.0,1.0);
#endif
#else
#ifdef NONLINEARDEPTH
#ifdef PACKED
gl_FragColor=pack(gl_FragCoord.z);
#else
gl_FragColor=vec4(gl_FragCoord.z,0.0,0.0,0.0);
#endif
#else
#ifdef PACKED
gl_FragColor=pack(vDepthMetric);
#else
gl_FragColor=vec4(vDepthMetric,0.0,0.0,1.0);
#endif
#endif
#endif
}`;e.ShadersStore[r]||(e.ShadersStore[r]=a);const f=[o,n,d];for(const i of f)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const g={name:r,shader:a};export{g as depthPixelShader};
