import{b6 as e}from"./index-CObigdMN.js";import{helperFunctions as r}from"./helperFunctions-P8WrsehS.js";import{l as a,a as l}from"./lightUboDeclaration-D_K7gx7N.js";import{lightsFragmentFunctions as f}from"./lightsFragmentFunctions-BoNwCUjC.js";import{s as t}from"./shadowsFragmentFunctions-BYx1AkON.js";import{clipPlaneFragmentDeclaration as s}from"./clipPlaneFragmentDeclaration-DA9vTRl3.js";import{logDepthDeclaration as m}from"./logDepthDeclaration-BFER5X4-.js";import{f as c,a as d}from"./fogFragment-DRXofeDw.js";import{clipPlaneFragment as g}from"./clipPlaneFragment-MpDmOtXv.js";import{d as u}from"./depthPrePass-BzqbJfEo.js";import{lightFragment as h}from"./lightFragment-B7IfpITm.js";import{l as v}from"./logDepthFragment-DuYMqP9J.js";import{i as p}from"./imageProcessingCompatibility-CNjw_Jii.js";import"./clusteredLightingFunctions-4ai_5IGT.js";import"./objectIdFunctions-dmxjRzUS.js";const o="normalPixelShader",n=`precision highp float;uniform vec4 vEyePosition;uniform vec4 vDiffuseColor;varying vec3 vPositionW;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#ifdef LIGHTING
#include<helperFunctions>
#include<__decl__lightFragment>[0]
#include<__decl__lightFragment>[1]
#include<__decl__lightFragment>[2]
#include<__decl__lightFragment>[3]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
#endif
#ifdef DIFFUSE
varying vec2 vDiffuseUV;uniform sampler2D diffuseSampler;uniform vec2 vDiffuseInfos;
#endif
#include<clipPlaneFragmentDeclaration>
#ifdef LOGARITHMICDEPTH
#extension GL_EXT_frag_depth : enable
#endif
#include<logDepthDeclaration>
#include<fogFragmentDeclaration>
#if defined(CLUSTLIGHT_BATCH) && CLUSTLIGHT_BATCH>0
varying float vViewDepth;
#endif
#define CUSTOM_FRAGMENT_DEFINITIONS
void main(void) {
#define CUSTOM_FRAGMENT_MAIN_BEGIN
#include<clipPlaneFragment>
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);vec4 baseColor=vec4(1.,1.,1.,1.);vec3 diffuseColor=vDiffuseColor.rgb;float alpha=vDiffuseColor.a;
#ifdef DIFFUSE
baseColor=texture2D(diffuseSampler,vDiffuseUV);
#ifdef ALPHATEST
if (baseColor.a<0.4)
discard;
#endif
#include<depthPrePass>
baseColor.rgb*=vDiffuseInfos.y;
#endif
#ifdef NORMAL
baseColor=mix(baseColor,vec4(vNormalW,1.0),0.5);
#endif
#ifdef NORMAL
vec3 normalW=normalize(vNormalW);
#else
vec3 normalW=vec3(1.0,1.0,1.0);
#endif
#ifdef LIGHTING
vec3 diffuseBase=vec3(0.,0.,0.);lightingInfo info;float shadow=1.;float glossiness=0.;float aggShadow=0.;float numLights=0.;
#include<lightFragment>[0]
#include<lightFragment>[1]
#include<lightFragment>[2]
#include<lightFragment>[3]
vec3 finalDiffuse=clamp(diffuseBase*diffuseColor,0.0,1.0)*baseColor.rgb;
#else
vec3 finalDiffuse= baseColor.rgb;
#endif
vec4 color=vec4(finalDiffuse,alpha);
#include<logDepthFragment>
#include<fogFragment>
gl_FragColor=color;
#include<imageProcessingCompatibility>
#define CUSTOM_FRAGMENT_MAIN_END
}`;e.ShadersStore[o]||(e.ShadersStore[o]=n);const F=[r,a,l,f,t,s,m,c,g,u,h,v,d,p];for(const i of F)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const U={name:o,shader:n};export{U as normalPixelShader};
