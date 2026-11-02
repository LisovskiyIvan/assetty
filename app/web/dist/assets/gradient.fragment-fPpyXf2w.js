import{b6 as e}from"./index-PTYp95FF.js";import{helperFunctions as n}from"./helperFunctions-BTwkhmwC.js";import{l as r,a as t}from"./lightUboDeclaration-tXWS5U_W.js";import{lightsFragmentFunctions as l}from"./lightsFragmentFunctions-Dxth0yLz.js";import{s}from"./shadowsFragmentFunctions-BBlthLGC.js";import{clipPlaneFragmentDeclaration as f}from"./clipPlaneFragmentDeclaration-Br1mFdIf.js";import{logDepthDeclaration as m}from"./logDepthDeclaration-CY7wbJsi.js";import{f as d,a as c}from"./fogFragment-COUHADiQ.js";import{clipPlaneFragment as g}from"./clipPlaneFragment-CP3xNskJ.js";import{d as h}from"./depthPrePass-C_u4MLVy.js";import{lightFragment as p}from"./lightFragment-DNq6oDmJ.js";import{l as u}from"./logDepthFragment-ozz_xa9x.js";import{i as v}from"./imageProcessingCompatibility-DjZFGgMj.js";import"./clusteredLightingFunctions-5yQM0b8X.js";import"./objectIdFunctions-Cw7rSI4G.js";const i="gradientPixelShader",a=`precision highp float;uniform vec4 vEyePosition;uniform vec4 topColor;uniform vec4 bottomColor;uniform float offset;uniform float scale;uniform float smoothness;varying vec3 vPositionW;varying vec3 vPosition;
#ifdef NORMAL
varying vec3 vNormalW;
#endif
#ifdef VERTEXCOLOR
varying vec4 vColor;
#endif
#include<helperFunctions>
#include<__decl__lightFragment>[0]
#include<__decl__lightFragment>[1]
#include<__decl__lightFragment>[2]
#include<__decl__lightFragment>[3]
#include<lightsFragmentFunctions>
#include<shadowsFragmentFunctions>
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
vec3 viewDirectionW=normalize(vEyePosition.xyz-vPositionW);float h=vPosition.y*scale+offset;float mysmoothness=clamp(smoothness,0.01,max(smoothness,10.));vec4 baseColor=mix(bottomColor,topColor,max(pow(max(h,0.0),mysmoothness),0.0));vec3 diffuseColor=baseColor.rgb;float alpha=baseColor.a;
#ifdef ALPHATEST
if (baseColor.a<0.4)
discard;
#endif
#include<depthPrePass>
#ifdef VERTEXCOLOR
baseColor.rgb*=vColor.rgb;
#endif
#ifdef NORMAL
vec3 normalW=normalize(vNormalW);
#else
vec3 normalW=vec3(1.0,1.0,1.0);
#endif
#ifdef EMISSIVE
vec3 diffuseBase=baseColor.rgb;
#else
vec3 diffuseBase=vec3(0.,0.,0.);
#endif
lightingInfo info;float shadow=1.;float glossiness=0.;float aggShadow=0.;float numLights=0.;
#include<lightFragment>[0..maxSimultaneousLights]
#if defined(VERTEXALPHA) || defined(INSTANCESCOLOR) && defined(INSTANCES)
alpha*=vColor.a;
#endif
vec3 finalDiffuse=clamp(diffuseBase*diffuseColor,0.0,1.0)*baseColor.rgb;vec4 color=vec4(finalDiffuse,alpha);
#include<logDepthFragment>
#include<fogFragment>
gl_FragColor=color;
#include<imageProcessingCompatibility>
#define CUSTOM_FRAGMENT_MAIN_END
}
`;e.ShadersStore[i]||(e.ShadersStore[i]=a);const C=[n,r,t,l,s,f,m,d,g,h,p,u,c,v];for(const o of C)e.IncludesShadersStore[o.name]||(e.IncludesShadersStore[o.name]=o.shader);const R={name:i,shader:a};export{R as gradientPixelShader};
