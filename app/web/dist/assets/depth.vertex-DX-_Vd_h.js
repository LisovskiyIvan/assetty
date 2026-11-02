import{b6 as e}from"./index-BncxKkTR.js";import{b as n,a as d,c as s,d as l}from"./bakedVertexAnimation-USFDuamG.js";import{m as c,a as f,b as u,c as p}from"./morphTargetsVertex-0SqVLfs3.js";import{clipPlaneVertexDeclaration as m}from"./clipPlaneVertexDeclaration-BQj6G1Ax.js";import{i as V}from"./instancesDeclaration-Dv3BxaMS.js";import{i as v}from"./instancesVertex-yQhndswN.js";import{clipPlaneVertex as x}from"./clipPlaneVertex-CGJ2eHJo.js";import{p as h}from"./pointCloudVertex-Dp7elUW8.js";const t="pointCloudVertexDeclaration",r=`#ifdef POINTSIZE
uniform float pointSize;
#endif
`;e.IncludesShadersStore[t]||(e.IncludesShadersStore[t]=r);const S={name:t,shader:r},a="depthVertexShader",o=`attribute vec3 position;
#include<bonesDeclaration>
#include<bakedVertexAnimationDeclaration>
#include<morphTargetsVertexGlobalDeclaration>
#include<morphTargetsVertexDeclaration>[0..maxSimultaneousMorphTargets]
#include<clipPlaneVertexDeclaration>
#include<instancesDeclaration>
uniform mat4 viewProjection;uniform vec2 depthValues;
#if defined(ALPHATEST) || defined(NEED_UV)
varying vec2 vUV;uniform mat4 diffuseMatrix;
#ifdef UV1
attribute vec2 uv;
#endif
#ifdef UV2
attribute vec2 uv2;
#endif
#endif
#ifdef STORE_CAMERASPACE_Z
uniform mat4 view;varying vec4 vViewPos;
#endif
#include<pointCloudVertexDeclaration>
varying float vDepthMetric;
#define CUSTOM_VERTEX_DEFINITIONS
void main(void)
{vec3 positionUpdated=position;
#ifdef UV1
vec2 uvUpdated=uv;
#endif
#ifdef UV2
vec2 uv2Updated=uv2;
#endif
#include<morphTargetsVertexGlobal>
#include<morphTargetsVertex>[0..maxSimultaneousMorphTargets]
#include<instancesVertex>
#include<bonesVertex>
#include<bakedVertexAnimation>
vec4 worldPos=finalWorld*vec4(positionUpdated,1.0);
#include<clipPlaneVertex>
gl_Position=viewProjection*worldPos;
#ifdef STORE_CAMERASPACE_Z
vViewPos=view*worldPos;
#else
#ifdef USE_REVERSE_DEPTHBUFFER
vDepthMetric=((-gl_Position.z+depthValues.x)/(depthValues.y));
#else
vDepthMetric=((gl_Position.z+depthValues.x)/(depthValues.y));
#endif
#endif
#if defined(ALPHATEST) || defined(BASIC_RENDER)
#ifdef UV1
vUV=vec2(diffuseMatrix*vec4(uvUpdated,1.0,0.0));
#endif
#ifdef UV2
vUV=vec2(diffuseMatrix*vec4(uv2Updated,1.0,0.0));
#endif
#endif
#include<pointCloudVertex>
}
`;e.ShadersStore[a]||(e.ShadersStore[a]=o);const D=[n,d,c,f,m,V,S,u,p,v,s,l,x,h];for(const i of D)e.IncludesShadersStore[i.name]||(e.IncludesShadersStore[i.name]=i.shader);const C={name:a,shader:o};export{C as depthVertexShader};
